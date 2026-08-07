import { pbkdf2Sync, timingSafeEqual } from "node:crypto"

// 验证 Django pbkdf2_sha256$<iterations>$<salt>$<b64hash>
function verifyDjangoPassword(raw: string, encoded: string): boolean {
  const [algo, iterStr, salt, hash] = encoded.split("$")
  if (algo !== "pbkdf2_sha256") return false
  const expected = Buffer.from(hash, "base64")
  const actual = pbkdf2Sync(raw, salt, Number(iterStr), expected.length, "sha256")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const encoded = "pbkdf2_sha256$1200000$JIVbwvl1TpoWNHUitEA0iJ$5pOkPVGvtZbPGHZ1DnYbhpbtywLdsnEKtzm66IBABIU="

const t0 = performance.now()
const ok = verifyDjangoPassword("student123", encoded)
const cost = performance.now() - t0

console.log("正确密码 :", ok)
console.log("错误密码 :", verifyDjangoPassword("wrongpass", encoded))
console.log("单次耗时 :", cost.toFixed(0), "ms  (1200000 轮迭代)")

// 透明升级路径：验通后改存 argon2id
const upgraded = await Bun.password.hash("student123", { algorithm: "argon2id" })
const t1 = performance.now()
const ok2 = await Bun.password.verify("student123", upgraded)
console.log("argon2id  :", ok2, "耗时", (performance.now() - t1).toFixed(0), "ms")
