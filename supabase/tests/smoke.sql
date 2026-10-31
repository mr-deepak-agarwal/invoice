-- Smoke test for the invoicing database. Run after schema.sql (or after
-- the migration). Raises an exception on the first failed assertion.
-- Uses a throwaway transaction-free style: it creates its own users and
-- leaves them behind, so run it on a scratch database only.
\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;

-- two tenants; the signup trigger creates their businesses
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test', '{"business_name":"Alpha Co"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test', '{"business_name":"Beta Co"}');

select pg_temp.assert((select count(*) from businesses where name in ('Alpha Co','Beta Co')) = 2, 'signup trigger creates a business per user');

update businesses set state_code = '08', gstin = '08AAACF1234B1Z5' where name = 'Alpha Co';
update businesses set state_code = '27' where name = 'Beta Co';

-- clients
insert into clients (business_id, name, state_code) select id, 'Marc', '30' from businesses where name = 'Alpha Co';
insert into clients (business_id, name, state_code) select id, 'Other', '27' from businesses where name = 'Beta Co';

-- duplicate client names (case-insensitive) are rejected
do $$ begin
  begin
    insert into clients (business_id, name) select id, 'MARC' from businesses where name = 'Alpha Co';
    raise exception 'ASSERTION FAILED: duplicate client name was accepted';
  exception when unique_violation then null; end;
end $$;

-- invoice creation as the service role: interstate, 18% -> IGST 1800 on 10000
set role service_role;
select pg_temp.assert(
  (select invoice_number ~ '^INV/[0-9]{4}/0001$'
     from create_invoice(
       (select id from businesses where name='Alpha Co'),
       (select id from clients where name='Marc'),
       'Web dev','998314', 10000, 0,0,18, 0,0,1800, 11800, '30','Goa', current_date + 15)),
  'first invoice is numbered PREFIX/FY/0001');

select pg_temp.assert(
  (select invoice_number ~ '/0002$' from create_invoice(
       (select id from businesses where name='Alpha Co'),
       (select id from clients where name='Marc'),
       'More','998314', 100, 0,0,18, 0,0,18, 118, '30','Goa', current_date + 15)),
  'second invoice is /0002');

-- every invoice gets a unique, 64-hex public token for the /pay page
select pg_temp.assert(
  (select count(*) = 2 and count(distinct public_token) = 2 and bool_and(public_token ~ '^[a-f0-9]{64}$')
     from invoices where business_id = (select id from businesses where name='Alpha Co')),
  'public tokens are 64 hex chars and unique');

-- a registered-or-not business can store a UPI id; garbage is refused
reset role;
update businesses set upi_id = 'alpha@okhdfcbank' where name = 'Alpha Co';
do $$ begin
  begin
    update businesses set upi_id = 'not a upi id' where name = 'Alpha Co';
    raise exception 'ASSERTION FAILED: bad UPI id accepted';
  exception when check_violation then null; end;
end $$;
set role service_role;

-- default payment terms: 0..365 allowed, nonsense refused; local-supply flag defaults off
select pg_temp.assert((select assume_local_supply = false and default_due_days is null from businesses where name='Alpha Co'), 'defaults start off (always ask)');
reset role;
update businesses set default_due_days = 0 where name = 'Alpha Co';
do $$ begin
  begin
    update businesses set default_due_days = 400 where name = 'Alpha Co';
    raise exception 'ASSERTION FAILED: 400-day terms accepted';
  exception when check_violation then null; end;
end $$;
set role service_role;

-- totals that do not add up are refused, and the counter does not advance
do $$ begin
  begin
    perform create_invoice((select id from businesses where name='Alpha Co'),(select id from clients where name='Marc'),
      'Bad','998314', 100, 0,0,18, 0,0,18, 999, '30','Goa', current_date + 1);
    raise exception 'ASSERTION FAILED: bad totals accepted';
  exception when sqlstate '22023' then null; end;
end $$;
select pg_temp.assert(
  (select invoice_number ~ '/0003$' from create_invoice(
       (select id from businesses where name='Alpha Co'),
       (select id from clients where name='Marc'),
       'Third','998314', 200, 0,0,18, 0,0,36, 236, '30','Goa', current_date + 1)),
  'a failed attempt leaves no gap in the numbering');

-- a client from another tenant is refused
do $$ begin
  begin
    perform create_invoice((select id from businesses where name='Alpha Co'),(select id from clients where name='Other'),
      'x','998314', 100, 0,0,18, 0,0,18, 118, '27','Maharashtra', current_date + 1);
    raise exception 'ASSERTION FAILED: cross-tenant client accepted';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- rate limiter: 2 allowed, 3rd refused
select pg_temp.assert(check_rate_limit('t:k', 2, 3600) is true, 'rate limit hit 1 allowed');
select pg_temp.assert(check_rate_limit('t:k', 2, 3600) is true, 'rate limit hit 2 allowed');
select pg_temp.assert(check_rate_limit('t:k', 2, 3600) is false, 'rate limit hit 3 refused');
reset role;

-- Row Level Security as tenant Alpha (browser with anon key + session)
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

select pg_temp.assert((select count(*) from invoices) = 3, 'tenant sees only own invoices');
select pg_temp.assert((select count(*) from clients) = 1, 'tenant sees only own clients');

-- marking paid is allowed
update invoices set status = 'paid' where invoice_number ~ '/0001$';
select pg_temp.assert((select status from invoices where invoice_number ~ '/0001$') = 'paid', 'tenant can mark paid');

-- but editing money is not
do $$ begin
  begin
    update invoices set total_value = 1, taxable_value = 1 where invoice_number ~ '/0002$';
    raise exception 'ASSERTION FAILED: issued invoice was edited';
  exception when sqlstate '23514' then null; end;
end $$;

-- nor inserting an invoice from the browser
do $$ begin
  begin
    insert into invoices (business_id, client_id, invoice_number, taxable_value, total_value, due_date, status)
    select b.id, c.id, 'HACK-1', 1, 1, current_date, 'sent' from businesses b join clients c on c.business_id=b.id limit 1;
    raise exception 'ASSERTION FAILED: browser inserted an invoice';
  exception when insufficient_privilege then null; end;
end $$;

-- nor calling the server-only functions
do $$ begin
  begin
    perform create_invoice('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), 'x','998314',1,0,0,0,0,0,0,1,'30','Goa',current_date);
    raise exception 'ASSERTION FAILED: browser called create_invoice';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin
    perform check_rate_limit('x', 1, 60);
    raise exception 'ASSERTION FAILED: browser called check_rate_limit';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;

\echo ALL SMOKE TESTS PASSED
