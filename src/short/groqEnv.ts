/** Returns GROQ_API_KEY from the environment or the repo-root .env. Never logs the value. */
import { requireEnv } from "../env";

export function getGroqKey(): string {
  return requireEnv("GROQ_API_KEY");
}
