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

/**
 * 验密码。**pbkdf2 那条分支永远不能删** —— 生产库 1710 个账号全是 Django 写的
 * pbkdf2，只会在各自下次登录时才升级成 argon2，删掉就是全站登不上。
 * 迭代次数是从哈希串里读的，所以 120000 到 1200000 的老哈希都验得了。
 */
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

/**
 * 写密码的**唯一入口**。五个调用方都走这里：注册、管理员改密码、批量导入用户、
 * 重置密码、登录时升级存量 pbkdf2。
 *
 * 之所以特意收成一个函数：原来五处各写各的 `Bun.password.hash`，而当年那个
 * 「回滚窗口内不要升级成 argon2」的开关只管住了登录
 * 那一处，另外四处照写 argon2 不误 —— 老师给学生点一次「重置密码」，那个账号
 * 就回不去旧站了，开关关着也拦不住。旧站 2026-08-26 下线，开关已经删掉，
 * 但「只有一个地方写密码」这件事留下来了。
 *
 * 真要把旧站拉回来：切换手册「万一已经改坏了」那节的脚本才是正经退路 ——
 * 它拿 `raw_password` 重算 Django 的 make_password，能修**已经**变成 argon2 的
 * 账号；靠开关只能拦住将来，修不了已经发生的。
 */
export function hashPassword(password: string) {
  return Bun.password.hash(password, { algorithm: "argon2id" })
}
