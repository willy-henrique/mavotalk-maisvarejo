import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: "org_willtalk_default" },
    update: {},
    create: {
      id: "org_willtalk_default",
      name: "Mavo Talk",
    },
  });

  await prisma.channel.upsert({
    where: { twilioPhoneNumber: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+5511999999999" },
    update: {},
    create: {
      organizationId: organization.id,
      provider: "twilio",
      twilioPhoneNumber: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+5511999999999",
      isActive: true,
    },
  });

  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || "admin123", 10);

  await prisma.user.upsert({
    where: { email: process.env.SEED_ADMIN_EMAIL || "admin@willtalk.local" },
    update: {
      role: UserRole.admin,
      passwordHash,
      organizationId: organization.id,
    },
    create: {
      organizationId: organization.id,
      name: "Administrador",
      email: process.env.SEED_ADMIN_EMAIL || "admin@willtalk.local",
      passwordHash,
      role: UserRole.admin,
    },
  });

  const demands = [
    { menuOption: 1, name: "Ofertas e promoções", colorHex: "#F97316", defaultSlaMins: 5 },
    { menuOption: 2, name: "Horários e localização", colorHex: "#3B82F6", defaultSlaMins: 5 },
    { menuOption: 3, name: "Produtos e disponibilidade", colorHex: "#14B8A6", defaultSlaMins: 15 },
    { menuOption: 4, name: "Açougue, padaria e hortifruti", colorHex: "#22C55E", defaultSlaMins: 15 },
    { menuOption: 5, name: "Trocas, devoluções e pagamentos", colorHex: "#EAB308", defaultSlaMins: 20 },
    { menuOption: 6, name: "Falar com um atendente", colorHex: "#EF4444", defaultSlaMins: 10 },
  ];

  for (const demand of demands) {
    const queue = await prisma.queue.upsert({
      where: { organizationId_menuOption: { organizationId: organization.id, menuOption: demand.menuOption } },
      update: {
        name: demand.name,
        colorHex: demand.colorHex,
        defaultSlaMins: demand.defaultSlaMins,
      },
      create: {
        organizationId: organization.id,
        ...demand,
      },
    });

    await prisma.slaPolicy.upsert({
      where: { queueId: queue.id },
      update: { firstResponseMins: demand.defaultSlaMins, warningBeforeMins: 10 },
      create: {
        organizationId: organization.id,
        queueId: queue.id,
        firstResponseMins: demand.defaultSlaMins,
        warningBeforeMins: 10,
      },
    });
  }

  await prisma.queue.updateMany({
    where: {
      organizationId: organization.id,
      menuOption: { notIn: demands.map((item) => item.menuOption) },
    },
    data: { isActive: false },
  });

  const businessDefaults = [
    { weekday: 1, startTime: "08:00", endTime: "18:00" },
    { weekday: 2, startTime: "08:00", endTime: "18:00" },
    { weekday: 3, startTime: "08:00", endTime: "18:00" },
    { weekday: 4, startTime: "08:00", endTime: "18:00" },
    { weekday: 5, startTime: "08:00", endTime: "18:00" },
  ];

  for (const item of businessDefaults) {
    await prisma.businessHour.upsert({
      where: { organizationId_weekday: { organizationId: organization.id, weekday: item.weekday } },
      update: item,
      create: {
        organizationId: organization.id,
        timezone: "America/Sao_Paulo",
        isActive: true,
        ...item,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

