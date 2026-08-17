import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.broadcastMessage.deleteMany();
  await prisma.broadcastSegment.deleteMany();
  await prisma.message.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.stockItem.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.settings.deleteMany();

  const [frontDesk, efua, kojo, abena] = await Promise.all([
    prisma.teamMember.create({ data: { name: "Front desk (AI)", isAi: true } }),
    prisma.teamMember.create({ data: { name: "Efua" } }),
    prisma.teamMember.create({ data: { name: "Kojo" } }),
    prisma.teamMember.create({ data: { name: "Abena", active: false } }),
  ]);

  const products = await Promise.all(
    [
      { name: "Jollof with chicken", price: 32, hidden: false },
      { name: "Waakye special", price: 38, hidden: false },
      { name: "Banku with tilapia", price: 45, hidden: false },
      { name: "Kelewele", price: 12, hidden: true },
    ].map((p) => prisma.product.create({ data: p }))
  );

  const customerData = [
    { name: "Ama Boateng", phone: "+233 24 118 4402" },
    { name: "Kwesi Mensah", phone: "+233 20 776 9013" },
    { name: "Naa Adjei", phone: "+233 55 402 1188" },
    { name: "Yaw Owusu", phone: "+233 27 330 5561" },
    { name: "Efe Danso", phone: "+233 54 900 7712" },
    { name: "Selina Appiah", phone: "+233 26 441 8890" },
    { name: "Doris Nyarko", phone: "+233 24 555 0102" },
  ];
  const customers: Record<string, Awaited<ReturnType<typeof prisma.customer.create>>> = {};
  for (const c of customerData) {
    customers[c.name] = await prisma.customer.create({ data: c });
  }

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  const orderSeeds = [
    {
      customer: "Ama Boateng",
      total: 84,
      paymentStatus: "AWAITING" as const,
      stage: "COOKING" as const,
      createdAt: minutesAgo(6),
      items: [
        { description: "Jollof with chicken", quantity: 2, unitPrice: 32 },
        { description: "Kelewele", quantity: 1, unitPrice: 12 },
        { description: "Sobolo", quantity: 2, unitPrice: 4 },
      ],
    },
    {
      customer: "Kwesi Mensah",
      total: 126,
      paymentStatus: "PAID" as const,
      stage: "OUT_FOR_DELIVERY" as const,
      createdAt: minutesAgo(14),
      items: [
        { description: "Waakye special", quantity: 3, unitPrice: 38 },
        { description: "Fried rice", quantity: 1, unitPrice: 8 },
        { description: "Malt", quantity: 3, unitPrice: 2 },
      ],
    },
    {
      customer: "Naa Adjei",
      total: 212,
      paymentStatus: "UNPAID" as const,
      stage: "WAITING_ON_YOU" as const,
      createdAt: minutesAgo(22),
      items: [
        { description: "Jollof (office tray)", quantity: 6, unitPrice: 20 },
        { description: "Grilled tilapia (office tray)", quantity: 6, unitPrice: 12 },
      ],
    },
    {
      customer: "Yaw Owusu",
      total: 58,
      paymentStatus: "PAID" as const,
      stage: "DELIVERED" as const,
      createdAt: minutesAgo(38),
      items: [
        { description: "Banku with tilapia", quantity: 1, unitPrice: 45 },
        { description: "Water", quantity: 1, unitPrice: 13 },
      ],
    },
    {
      customer: "Efe Danso",
      total: 160,
      paymentStatus: "CASH" as const,
      stage: "OUT_FOR_DELIVERY" as const,
      createdAt: minutesAgo(51),
      items: [
        { description: "Jollof with chicken", quantity: 4, unitPrice: 32 },
        { description: "Kelewele", quantity: 2, unitPrice: 16 },
      ],
    },
    {
      customer: "Selina Appiah",
      total: 96,
      paymentStatus: "PAID" as const,
      stage: "DELIVERED" as const,
      createdAt: minutesAgo(60),
      items: [
        { description: "Waakye special", quantity: 2, unitPrice: 38 },
        { description: "Sobolo", quantity: 2, unitPrice: 10 },
      ],
    },
  ];

  for (const seed of orderSeeds) {
    const order = await prisma.order.create({
      data: {
        customerId: customers[seed.customer].id,
        total: seed.total,
        paymentStatus: seed.paymentStatus,
        stage: seed.stage,
        createdAt: seed.createdAt,
        items: { create: seed.items },
      },
    });

    if (seed.paymentStatus === "PAID") {
      await prisma.payment.create({
        data: {
          orderId: order.id,
          provider: "MTN_MOMO",
          providerRef: `MOMO-${order.number}`,
          status: "PAID",
          amount: seed.total,
        },
      });
    } else if (seed.paymentStatus === "AWAITING") {
      await prisma.payment.create({
        data: {
          orderId: order.id,
          provider: "MTN_MOMO",
          providerRef: `MOMO-${order.number}`,
          status: "AWAITING",
          amount: seed.total,
        },
      });
    }
  }

  await prisma.stockItem.createMany({
    data: [
      { name: "Jollof rice (portions)", quantity: 4, unit: "portions", lowThreshold: 8 },
      { name: "Chicken thigh", quantity: 31, unit: "pieces", lowThreshold: 10 },
      { name: "Tilapia", quantity: 5, unit: "pieces", lowThreshold: 8 },
      { name: "Sobolo (bottles)", quantity: 48, unit: "bottles", lowThreshold: 10 },
      { name: "Kelewele packs", quantity: 9, unit: "packs", lowThreshold: 12 },
    ],
  });

  await prisma.message.createMany({
    data: [
      {
        customerId: customers["Ama Boateng"].id,
        direction: "INBOUND",
        body: "New order from Ama Boateng",
        createdAt: minutesAgo(6),
      },
      {
        customerId: customers["Kwesi Mensah"].id,
        direction: "INBOUND",
        body: "Kwesi paid ₵126 by MoMo",
        createdAt: minutesAgo(14),
      },
      {
        customerId: customers["Naa Adjei"].id,
        direction: "OUTBOUND",
        body: "Nudge sent to Naa Adjei",
        repliedById: frontDesk.id,
        createdAt: minutesAgo(11),
      },
    ],
  });

  await prisma.broadcastSegment.create({
    data: {
      name: "Haven't ordered in 30 days",
      description: "46 customers",
      messages: { create: [] },
    },
  });
  await prisma.broadcastSegment.create({
    data: { name: "Friday regulars", description: "112 customers" },
  });
  await prisma.broadcastSegment.create({
    data: { name: "Office tray buyers", description: "18 customers" },
  });

  await prisma.settings.create({
    data: {
      id: 1,
      currency: "₵",
      showAiLabels: true,
      whatsappNumber: "+233 30 244 0119",
      whatsappConnected: true,
      momoConnected: true,
      airtelConnected: false,
      openingHours: "Mon–Sat, 10am–9pm",
      languages: "English, Twi",
    },
  });

  console.log(`Seeded ${orderSeeds.length} orders, ${customerData.length} customers, ${products.length} products.`);
  console.log(`Team: ${efua.name}, ${kojo.name}, ${abena.name}, ${frontDesk.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
