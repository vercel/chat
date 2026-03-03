import { config } from "dotenv";

config();

export const PHONE_NUMBER = process.env.SIGNAL_PHONE_NUMBER;
export const SERVICE_URL =
  process.env.SIGNAL_SERVICE_URL ?? "http://localhost:8080";
export const RECIPIENT = process.env.SIGNAL_RECIPIENT;
export const GROUP_ID = process.env.SIGNAL_GROUP_ID;

if (!PHONE_NUMBER) {
  console.error("❌ SIGNAL_PHONE_NUMBER is required. See .env.example");
  process.exit(1);
}
