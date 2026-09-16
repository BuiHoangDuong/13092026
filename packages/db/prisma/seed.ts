import { PrismaClient, PublishStatus } from "../dist/generated/client/index.js";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const exchanges = [
  { slug: "binance", name: "Binance", rate: "0.4000", destination: "https://www.binance.com/" },
  { slug: "mexc", name: "MEXC", rate: "0.3500", destination: "https://www.mexc.com/" },
  { slug: "bybit", name: "Bybit", rate: "0.3000", destination: "https://www.bybit.com/" }
];

async function main() {
  for (const item of exchanges) {
    const exchangeI18n = {
      en: { name: item.name, description: `Earn cashback on ${item.name} trading fees.` }
    };
    const exchange = await prisma.exchange.upsert({
      where: { slug: item.slug },
      update: { name: item.name, status: PublishStatus.PUBLISHED, defaultCashbackRate: item.rate, i18n: exchangeI18n },
      create: { slug: item.slug, name: item.name, status: PublishStatus.PUBLISHED, defaultCashbackRate: item.rate,
        i18n: exchangeI18n }
    });

    const offerSeedKey = `default-offer:${item.slug}`;
    const existingSeedOffer = await prisma.offer.findUnique({ where: { seedKey: offerSeedKey } });
    if (!existingSeedOffer) {
      const legacyOffer = await prisma.offer.findFirst({
        where: { exchangeId: exchange.id, seedKey: null },
        orderBy: { id: "asc" }
      });
      if (legacyOffer) {
        await prisma.offer.update({ where: { id: legacyOffer.id }, data: { seedKey: offerSeedKey } });
      }
    }

    const offer = await prisma.offer.upsert({
      where: { seedKey: offerSeedKey },
      update: {
        exchangeId: exchange.id,
        status: PublishStatus.PUBLISHED,
        cashbackRate: item.rate,
        conditions: { en: "Cashback applies to eligible affiliate commission." },
        verifiedAt: new Date()
      },
      create: {
        seedKey: offerSeedKey,
        exchangeId: exchange.id,
        status: PublishStatus.PUBLISHED,
        cashbackRate: item.rate,
        conditions: { en: "Cashback applies to eligible affiliate commission." },
        verifiedAt: new Date()
      }
    });

    const linkSeedKey = `default-link:${item.slug}`;
    const existingSeedLink = await prisma.referralLink.findUnique({ where: { seedKey: linkSeedKey } });
    if (!existingSeedLink) {
      const legacyLink = await prisma.referralLink.findFirst({
        where: { exchangeId: exchange.id, destination: item.destination, seedKey: null },
        orderBy: { id: "asc" }
      });
      if (legacyLink) {
        await prisma.referralLink.update({ where: { id: legacyLink.id }, data: { seedKey: linkSeedKey } });
      }
    }

    await prisma.referralLink.upsert({
      where: { seedKey: linkSeedKey },
      update: { exchangeId: exchange.id, offerId: offer.id, destination: item.destination, active: true },
      create: { seedKey: linkSeedKey, exchangeId: exchange.id, offerId: offer.id, destination: item.destination }
    });

    const guideI18n = {
      en: { title: `${item.name} cashback guide`, content: `Use the verified ${item.name} referral link before linking your UID.` }
    };
    await prisma.guide.upsert({
      where: { slug: `${item.slug}-cashback-guide` },
      update: { exchangeId: exchange.id, status: PublishStatus.PUBLISHED, i18n: guideI18n },
      create: { slug: `${item.slug}-cashback-guide`, exchangeId: exchange.id, status: PublishStatus.PUBLISHED, i18n: guideI18n }
    });
  }

  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!", 12);
  await prisma.adminAccount.upsert({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com" },
    update: { passwordHash },
    create: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", passwordHash }
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
