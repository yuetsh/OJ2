import { pbkdf2, randomInt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

import { config } from "../config"

const pbkdf2Async = promisify(pbkdf2)

/**
 * Django 的 salt 字符集与长度：`RANDOM_STRING_CHARS` + `BasePasswordHasher.salt()`
 * 取 22 位。字符集必须一致 —— 旧后端验密码时只按 `$` 切段、不校验字符集，
 * 但对齐了才能保证同一条哈希在两边长得一模一样。
 */
const DJANGO_SALT_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

/**
 * 对齐 Django 6 的 `PBKDF2PasswordHasher.iterations`。
 *
 * 这个数只影响**新写**的哈希；验旧哈希时迭代次数是从哈希串里读的，所以生产库里
 * 那些 120000 / 260000 / 720000 / 1000000 的老哈希照验不误（1710 个账号横跨
 * Django 3.x 到 6，全是 pbkdf2）。
 */
const DJANGO_ITERATIONS = 1_200_000

function djangoSalt() {
  let salt = ""
  for (let i = 0; i < 22; i++) {
    salt += DJANGO_SALT_CHARS[randomInt(DJANGO_SALT_CHARS.length)]
  }
  return salt
}

/** 写成 Django 认得的 `pbkdf2_sha256$迭代次数$salt$base64` */
export async function hashDjangoPbkdf2(password: string) {
  const salt = djangoSalt()
  const digest = await pbkdf2Async(password, salt, DJANGO_ITERATIONS, 32, "sha256")
  return `pbkdf2_sha256$${DJANGO_ITERATIONS}$${salt}$${digest.toString("base64")}`
}

/**
 * 写密码。默认 argon2id；`PASSWORD_HASH_UPGRADE=false` 时改写 Django 格式的
 * pbkdf2（旧后端验得了），是万一要把旧站拉回来的退路。见 config 里的注释。
 *
 * 原来五个写入点全都直接 `Bun.password.hash(argon2id)`，而
 * `config.passwordHashUpgrade` 只管住了登录时的自动升级那一处：
 *
 *   POST /users                        注册
 *   PUT  /admin/users/:id              管理员改密码
 *   POST /admin/users                  批量导入用户
 *   POST /admin/users/:id/reset-password   重置密码  ← 老师天天在用
 *   登录成功后的自动升级                （只有这一处受开关管）
 *
 * 也就是说开关关着的时候，老师给学生点一次「重置密码」，那个账号就**立刻回不去
 * 旧站了**。而「老师帮学生查/改密码」恰恰是这套系统的日常功能 ——
 * `raw_password` 那一列存在的理由就是它。
 *
 * 现在五处统一走这里，开关两个方向都是真的。
 */
export function hashPassword(password: string) {
  return config.passwordHashUpgrade
    ? Bun.password.hash(password, { algorithm: "argon2id" })
    : hashDjangoPbkdf2(password)
}

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
