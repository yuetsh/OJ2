import { pbkdf2, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const pbkdf2Async = promisify(pbkdf2)

async function verifyDjangoPbkdf2(password: string, encoded: string) {
  const [algorithm, iterationsText, salt, digestText] = encoded.split("$")
  if (
    algorithm !== "pbkdf2_sha256" ||
    !iterationsText ||
    !salt ||
    !digestText
  ) {
    return false
  }

  const iterations = Number(iterationsText)
  const expected = Buffer.from(digestText, "base64")
  if (!Number.isSafeInteger(iterations) || iterations <= 0 || expected.length === 0) {
    return false
  }

  const actual = await pbkdf2Async(
    password,
    salt,
    iterations,
    expected.length,
    "sha256",
  )
  return timingSafeEqual(actual, expected)
}

export async function verifyPassword(password: string, encoded: string) {
  if (encoded.startsWith("pbkdf2_sha256$")) {
    return {
      valid: await verifyDjangoPbkdf2(password, encoded),
      needsUpgrade: true,
    }
  }

  if (encoded.startsWith("$argon2")) {
    return {
      valid: await Bun.password.verify(password, encoded),
      needsUpgrade: false,
    }
  }

  return { valid: false, needsUpgrade: false }
}
