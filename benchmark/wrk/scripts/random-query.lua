local charset = "abcdefghijklmnopqrstuvwxyz0123456789"

local function random_string(length)
  local res = {}
  for i = 1, length do
    local idx = math.random(1, #charset)
    res[i] = charset:sub(idx, idx)
  end
  return table.concat(res)
end

request = function()
  local key = random_string(8)
  local value = random_string(12)
  return wrk.format("GET", "/api/data?" .. key .. "=" .. value)
end
