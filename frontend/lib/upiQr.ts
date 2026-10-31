import QRCode from "qrcode";

/** SVG markup for a QR code of `text`. Server-side only. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
