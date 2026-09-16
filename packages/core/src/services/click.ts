import { db } from "@cashback/db";

export async function resolveReferralLink(linkId: string) {
  return db.referralLink.findFirst({ where: { id: linkId, active: true }, select: { id: true, destination: true } });
}

export async function recordClick(linkId: string) {
  await db.clickEvent.create({ data: { linkId } });
}
