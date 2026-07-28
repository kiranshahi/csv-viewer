/// <reference lib="webworker" />

const delimiters = [
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe" },
];

function detectDelimiter(text: string) {
  const sample = text.slice(0, 100_000);
  return delimiters
    .map(({ value, label }) => {
      const counts: number[] = [];
      let quoted = false;
      let count = 0;
      for (let i = 0; i < sample.length && counts.length < 12; i += 1) {
        const char = sample[i];
        if (char === '"') {
          if (quoted && sample[i + 1] === '"') i += 1;
          else quoted = !quoted;
        } else if (char === value && !quoted) count += 1;
        else if ((char === "\n" || char === "\r") && !quoted) {
          if (char === "\r" && sample[i + 1] === "\n") i += 1;
          if (count > 0) counts.push(count);
          count = 0;
        }
      }
      if (count > 0) counts.push(count);
      const frequency = new Map<number, number>();
      counts.forEach((item) =>
        frequency.set(item, (frequency.get(item) ?? 0) + 1),
      );
      return {
        value,
        label,
        score:
          Math.max(0, ...frequency.values()) * 100 + Math.max(0, ...counts),
      };
    })
    .sort((a, b) => b.score - a.score)[0];
}

function parse(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

self.onmessage = (event: MessageEvent<{ text: string }>) => {
  const text = event.data.text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text) ?? delimiters[0];
  self.postMessage({
    rows: parse(text, delimiter.value),
    delimiterLabel: delimiter.label,
  });
};

export {};
