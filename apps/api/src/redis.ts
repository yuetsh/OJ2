import Redis from "ioredis"

import { config } from "./config"

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
})

export function createBlockingRedis() {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  })
}

export function createSubscriberRedis() {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  })
}
