import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: "org_willtalk_default" },
    update: {},
    create: {
      id: "org_willtalk_default",
      name: "WillTalk Suporte",
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
    { menuOption: 1, name: "SPED (FISCAL)", colorHex: "#0EA5E9", defaultSlaMins: 30 },
    { menuOption: 2, name: "Notas Saídas", colorHex: "#10B981", defaultSlaMins: 30 },
    { menuOption: 3, name: "Notas Entrada", colorHex: "#F59E0B", defaultSlaMins: 30 },
    { menuOption: 4, name: "Balança", colorHex: "#EF4444", defaultSlaMins: 45 },
    { menuOption: 5, name: "Impressora", colorHex: "#8B5CF6", defaultSlaMins: 45 },
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

