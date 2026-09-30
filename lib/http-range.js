function parseSingleByteRange(rangeHeader, size) {
  if (!Number.isInteger(size) || size < 0) {
    throw new TypeError("size must be a non-negative integer");
  }

  if (!rangeHeader) return null;
  if (typeof rangeHeader !== "string" || !rangeHeader.startsWith("bytes=")) {
    return { invalid: true };
  }

  const value = rangeHeader.slice(6).trim();
  if (!value || value.includes(",")) return { invalid: true };

  const match = /^(\d*)-(\d*)$/.exec(value);
  if (!match) return { invalid: true };

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { invalid: true };
  if (size === 0) return { unsatisfiable: true };

  let start;
  let end;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { invalid: true };
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startRaw);
    if (!Number.isSafeInteger(start) || start < 0) return { invalid: true };
    if (start >= size) return { unsatisfiable: true };

    if (!endRaw) {
      end = size - 1;
    } else {
      end = Number(endRaw);
      if (!Number.isSafeInteger(end) || end < start) return { invalid: true };
      end = Math.min(end, size - 1);
    }
  }

  return {
    start,
    end,
    length: end - start + 1,
  };
}

module.exports = { parseSingleByteRange };
