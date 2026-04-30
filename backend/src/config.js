import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  frontendUrl:
    process.env.PUBLIC_APP_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePriceId:
    process.env.STRIPE_FAMILY_PRICE_ID || process.env.STRIPE_PRICE_ID || "",
  supportEmail: process.env.SUPPORT_EMAIL || "hello@familytrack.care",
  emailFrom: process.env.EMAIL_FROM || "FamilyTrack <hello@familytrack.care>",
  emailProvider: process.env.EMAIL_PROVIDER || "resend",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL || "",
  spacesKey: process.env.DO_SPACES_KEY || "",
  spacesSecret: process.env.DO_SPACES_SECRET || "",
  spacesBucket: process.env.DO_SPACES_BUCKET || "",
  spacesRegion: process.env.DO_SPACES_REGION || "",
  spacesEndpoint: process.env.DO_SPACES_ENDPOINT || "",
  spacesPublicUrl: process.env.DO_SPACES_PUBLIC_URL || "",
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
};

export function requireConfig() {
  const missing = [];

  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.sessionSecret) missing.push("SESSION_SECRET");

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
