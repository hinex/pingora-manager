wrk.method = "POST"
wrk.headers["Content-Type"] = "application/json"

request = function()
  local body = string.format('{"value":%d}', math.random(1, 1000000))
  return wrk.format("POST", "/api/data", nil, body)
end
