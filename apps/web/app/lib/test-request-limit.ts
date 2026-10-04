// Coarse per-process protection before Next auth handlers. The API owns durable quotas.
let until = 0
let requests = 0
export function allowTestRequest(now = Date.now()) {
  if (process.env.TEST_MODE === 'false') return true
  if (now >= until) { until = now + 60_000; requests = 0 }
  return ++requests <= 120
}
