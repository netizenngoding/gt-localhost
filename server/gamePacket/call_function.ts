import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage } from "../onVariant";
import { openSocialPortal } from "../action/social_portal";

type VariantValue = string | number;

function parseVariants(data: Buffer): VariantValue[] | null {
  if (!data.length || data.length > 16384) return null;
  const count = data[0];
  const values: VariantValue[] = [];
  let p = 1;
  for (let n = 0; n < count; n++) {
    if (p + 2 > data.length) return null;
    const index = data[p++];
    const type = data[p++];
    let value: VariantValue;
    if (type === 2) {
      if (p + 4 > data.length) return null;
      const len = data.readUInt32LE(p);
      p += 4;
      if (len > 4096 || p + len > data.length) return null;
      value = data.toString("utf8", p, p + len);
      p += len;
    } else if (type === 1) {
      if (p + 4 > data.length) return null;
      value = data.readFloatLE(p);
      p += 4;
    } else if (type === 5) {
      if (p + 4 > data.length) return null;
      value = data.readUInt32LE(p);
      p += 4;
    } else if (type === 9) {
      if (p + 4 > data.length) return null;
      value = data.readInt32LE(p);
      p += 4;
    } else {
      return null;
    }
    values[index] = value;
  }
  return values;
}

function validRgba(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(",");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function handleCallFunction(ctx: ServerContext, session: PlayerSession, extendedData: Buffer | undefined): void {
  if (!extendedData) return;
  const args = parseVariants(extendedData);
  if (!args) return;
  if (args[0] === "OnMagnoliaColorCancel") {
    openSocialPortal(ctx, session, "Bg_Setting");
    return;
  }
  if (args[0] !== "OnMagnoliaColorApply") return;
  if (!validRgba(args[1]) || !validRgba(args[2])) {
    OnConsoleMessage(session, "`4Invalid color value.``");
    openSocialPortal(ctx, session, "Bg_Setting");
    return;
  }
  session.account.borderColor = args[1];
  session.account.bgColor = args[2];
  OnConsoleMessage(session, "`2Custom theme saved!``");
  openSocialPortal(ctx, session, "Bg_Setting");
}
