"use client";

import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Cell = string;
type SortState = { column: number; direction: "asc" | "desc" } | null;
type EditAction = {
  row: number;
  column: number;
  before: string;
  after: string;
};
type EditingCell = { row: number; column: number; value: string } | null;
type ExportFormat = "csv" | "json" | "markdown" | "html" | "sql";
type FilterOperator =
  | "contains"
  | "equals"
  | "starts"
  | "empty"
  | "not-empty"
  | "greater"
  | "less"
  | "between";
type ColumnFilter = {
  operator: FilterOperator;
  value: string;
  valueTo: string;
};
type ToolTab = "clean" | "compare" | "summary";
type CleanAction = "trim" | "upper" | "lower" | "title" | "fill" | "replace";
type Aggregate = "count" | "sum" | "average" | "min" | "max";
type ColumnStat = {
  index: number;
  name: string;
  type: "Number" | "Date" | "Text" | "Empty";
  populated: number;
  missing: number;
  unique: number;
  minimum?: string;
  maximum?: string;
  average?: string;
};

const SAMPLE = `Name,Role,Location,Status,Last active
Maya Chen,Product Designer,London,Active,2026-07-28
Leo Martins,Frontend Engineer,Lisbon,Active,2026-07-27
Amara Okafor,Data Analyst,Lagos,Away,2026-07-25
Noah Williams,Support Lead,Manchester,Active,2026-07-28
Sofia Rossi,Marketing Manager,Milan,Offline,2026-07-21
Ethan Kim,Backend Engineer,Seoul,Active,2026-07-28
Priya Shah,Researcher,Bristol,Away,2026-07-24
Oliver Jensen,Operations,Copenhagen,Active,2026-07-26`;

const DELIMITERS = [
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe" },
];

function detectDelimiter(text: string) {
  const sample = text.slice(0, 100_000);
  const scores = DELIMITERS.map(({ value, label }) => {
    const counts: number[] = [];
    let quoted = false;
    let count = 0;

    for (let i = 0; i < sample.length && counts.length < 12; i += 1) {
      const char = sample[i];
      if (char === '"') {
        if (quoted && sample[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (char === value && !quoted) {
        count += 1;
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && sample[i + 1] === "\n") i += 1;
        if (count > 0) counts.push(count);
        count = 0;
      }
    }

    if (count > 0) counts.push(count);
    const frequency = new Map<number, number>();
    counts.forEach((item) => frequency.set(item, (frequency.get(item) ?? 0) + 1));
    const consistency = Math.max(0, ...frequency.values());
    const columns = Math.max(0, ...counts);
    return { value, label, score: consistency * 100 + columns };
  });

  return scores.sort((a, b) => b.score - a.score)[0] ?? DELIMITERS[0];
}

function parseCSV(text: string, delimiter = ",") {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function escapeCSV(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function downloadBlob(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseInWorker(text: string) {
  return new Promise<{ rows: Cell[][]; delimiterLabel: string }>(
    (resolve, reject) => {
      const worker = new Worker(new URL("./csv.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event) => {
        resolve(event.data);
        worker.terminate();
      };
      worker.onerror = (event) => {
        reject(new Error(event.message));
        worker.terminate();
      };
      worker.postMessage({ text });
    },
  );
}

function DataIcon() {
  return (
    <span className="data-icon" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export default function Home() {
  const [rows, setRows] = useState<Cell[][]>([]);
  const [fileName, setFileName] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    if (typeof window === "undefined") return 10;
    const saved = Number(window.localStorage.getItem("csv-viewer-page-size"));
    return [0, 10, 25, 50, 100].includes(saved) ? saved : 10;
  });
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(new Set());
  const [moveColumnFrom, setMoveColumnFrom] = useState(1);
  const [moveColumnTo, setMoveColumnTo] = useState(1);
  const [columnFilters, setColumnFilters] = useState<Record<number, ColumnFilter>>({});
  const [delimiterLabel, setDelimiterLabel] = useState("Comma");
  const [showInsights, setShowInsights] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [chartLabelColumn, setChartLabelColumn] = useState(0);
  const [chartValueColumn, setChartValueColumn] = useState(0);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [undoStack, setUndoStack] = useState<EditAction[]>([]);
  const [redoStack, setRedoStack] = useState<EditAction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [toolTab, setToolTab] = useState<ToolTab>("clean");
  const [cleanColumn, setCleanColumn] = useState(0);
  const [cleanAction, setCleanAction] = useState<CleanAction>("trim");
  const [cleanFind, setCleanFind] = useState("");
  const [cleanReplacement, setCleanReplacement] = useState("");
  const [toolMessage, setToolMessage] = useState("");
  const [comparisonRows, setComparisonRows] = useState<Cell[][]>([]);
  const [comparisonName, setComparisonName] = useState("");
  const [primaryKey, setPrimaryKey] = useState(0);
  const [comparisonKey, setComparisonKey] = useState(0);
  const [groupColumn, setGroupColumn] = useState(0);
  const [aggregateColumn, setAggregateColumn] = useState(0);
  const [aggregate, setAggregate] = useState<Aggregate>("count");
  const [scrollTop, setScrollTop] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);

  const headers = useMemo(() => rows[0] ?? [], [rows]);
  const data = useMemo(() => rows.slice(1), [rows]);
  const visibleColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ index }) => !hiddenColumns.has(index));

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const activeColumnFilters = Object.entries(columnFilters).filter(([, filter]) =>
      ["empty", "not-empty"].includes(filter.operator) || filter.value.trim() !== "",
    );
    const filtered = data.filter((row) => {
      const matchesSearch =
        !normalized ||
        row.some((value) => value.toLocaleLowerCase().includes(normalized));
      const matchesColumns = activeColumnFilters.every(([column, filter]) => {
        const raw = (row[Number(column)] ?? "").trim();
        const value = raw.toLocaleLowerCase();
        const target = filter.value.trim().toLocaleLowerCase();
        if (filter.operator === "empty") return raw === "";
        if (filter.operator === "not-empty") return raw !== "";
        if (filter.operator === "equals") return value === target;
        if (filter.operator === "starts") return value.startsWith(target);
        if (filter.operator === "greater") return Number(raw) > Number(filter.value);
        if (filter.operator === "less") return Number(raw) < Number(filter.value);
        if (filter.operator === "between") {
          const numeric = Number(raw);
          return numeric >= Number(filter.value) && numeric <= Number(filter.valueTo);
        }
        return value.includes(target);
      });
      return matchesSearch && matchesColumns;
    });

    if (!sort) return filtered;
    return [...filtered].sort((a, b) => {
      const left = a[sort.column] ?? "";
      const right = b[sort.column] ?? "";
      const numericLeft = Number(left);
      const numericRight = Number(right);
      const comparison =
        left !== "" &&
        right !== "" &&
        !Number.isNaN(numericLeft) &&
        !Number.isNaN(numericRight)
          ? numericLeft - numericRight
          : left.localeCompare(right, undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [columnFilters, data, query, sort]);

  const columnStats = useMemo<ColumnStat[]>(() => {
    return headers.map((header, index) => {
      const values = data.map((row) => (row[index] ?? "").trim());
      const populatedValues = values.filter((value) => value !== "");
      const numericValues = populatedValues.map(Number);
      const isNumeric =
        populatedValues.length > 0 &&
        numericValues.every((value) => !Number.isNaN(value));
      const isDate =
        populatedValues.length > 0 &&
        populatedValues.every(
          (value) =>
            /^\d{4}-\d{2}-\d{2}/.test(value) &&
            !Number.isNaN(Date.parse(value)),
        );
      const type =
        populatedValues.length === 0
          ? "Empty"
          : isNumeric
            ? "Number"
            : isDate
              ? "Date"
              : "Text";
      const stat: ColumnStat = {
        index,
        name: header || `Column ${index + 1}`,
        type,
        populated: populatedValues.length,
        missing: values.length - populatedValues.length,
        unique: new Set(populatedValues).size,
      };

      if (isNumeric) {
        const minimum = numericValues.reduce(
          (current, value) => Math.min(current, value),
          Number.POSITIVE_INFINITY,
        );
        const maximum = numericValues.reduce(
          (current, value) => Math.max(current, value),
          Number.NEGATIVE_INFINITY,
        );
        stat.minimum = minimum.toLocaleString();
        stat.maximum = maximum.toLocaleString();
        stat.average = (
          numericValues.reduce((sum, value) => sum + value, 0) /
          numericValues.length
        ).toLocaleString(undefined, { maximumFractionDigits: 2 });
      } else if (isDate) {
        stat.minimum = populatedValues.reduce((current, value) =>
          value < current ? value : current,
        );
        stat.maximum = populatedValues.reduce((current, value) =>
          value > current ? value : current,
        );
      }
      return stat;
    });
  }, [data, headers]);

  const duplicateRows = useMemo(() => {
    const seen = new Set<string>();
    let duplicates = 0;
    data.forEach((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) duplicates += 1;
      else seen.add(key);
    });
    return duplicates;
  }, [data]);

  const validation = useMemo(() => {
    const duplicateHeaders =
      headers.length - new Set(headers.map((header) => header.trim())).size;
    const unevenRows = data.filter((row) => row.length !== headers.length).length;
    const missingCells = columnStats.reduce(
      (total, stat) => total + stat.missing,
      0,
    );
    return { duplicateHeaders, unevenRows, missingCells };
  }, [columnStats, data, headers]);

  const numericColumns = columnStats.filter((stat) => stat.type === "Number");
  const chartRows = useMemo(() => {
    return filteredRows
      .map((row) => ({
        label: row[chartLabelColumn] || "—",
        value: Number(row[chartValueColumn]),
      }))
      .filter((item) => !Number.isNaN(item.value))
      .slice(0, 30);
  }, [chartLabelColumn, chartValueColumn, filteredRows]);
  const chartMaximum = Math.max(1, ...chartRows.map((item) => Math.abs(item.value)));

  const activeFilterCount = Object.values(columnFilters).filter(
    (filter) =>
      ["empty", "not-empty"].includes(filter.operator) ||
      filter.value.trim() !== "",
  ).length;

  const pageCount =
    pageSize === 0
      ? 1
      : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRows =
    pageSize === 0
      ? filteredRows
      : filteredRows.slice(
          (currentPage - 1) * pageSize,
          currentPage * pageSize,
        );
  const virtualize = pageSize === 0 && pagedRows.length > 150;
  const virtualStart = virtualize ? Math.max(0, Math.floor(scrollTop / 48) - 8) : 0;
  const virtualEnd = virtualize
    ? Math.min(pagedRows.length, virtualStart + 40)
    : pagedRows.length;
  const visibleRows = pagedRows.slice(virtualStart, virtualEnd);
  const topSpacer = virtualize ? virtualStart * 48 : 0;
  const bottomSpacer = virtualize ? (pagedRows.length - virtualEnd) * 48 : 0;

  const comparison = useMemo(() => {
    if (comparisonRows.length < 1) return null;
    const otherHeaders = comparisonRows[0] ?? [];
    const otherData = comparisonRows.slice(1);
    const left = new Map(data.map((row) => [row[primaryKey] ?? "", row]));
    const right = new Map(otherData.map((row) => [row[comparisonKey] ?? "", row]));
    let changed = 0;
    let unchanged = 0;
    left.forEach((row, key) => {
      const other = right.get(key);
      if (!other) return;
      if (JSON.stringify(row) === JSON.stringify(other)) unchanged += 1;
      else changed += 1;
    });
    return {
      otherHeaders,
      otherData,
      added: [...right.keys()].filter((key) => !left.has(key)).length,
      removed: [...left.keys()].filter((key) => !right.has(key)).length,
      changed,
      unchanged,
    };
  }, [comparisonKey, comparisonRows, data, primaryKey]);

  const summaryRows = useMemo(() => {
    const groups = new Map<string, number[]>();
    filteredRows.forEach((row) => {
      const key = row[groupColumn] || "(empty)";
      const values = groups.get(key) ?? [];
      const numeric = Number(row[aggregateColumn]);
      if (!Number.isNaN(numeric)) values.push(numeric);
      groups.set(key, values);
    });
    return [...groups.entries()]
      .map(([label, values]) => {
        if (aggregate === "count") return { label, value: filteredRows.filter((row) => (row[groupColumn] || "(empty)") === label).length };
        if (values.length === 0) return { label, value: 0 };
        if (aggregate === "sum") return { label, value: values.reduce((sum, value) => sum + value, 0) };
        if (aggregate === "average") return { label, value: values.reduce((sum, value) => sum + value, 0) / values.length };
        if (aggregate === "min") return { label, value: Math.min(...values) };
        return { label, value: Math.max(...values) };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 100);
  }, [aggregate, aggregateColumn, filteredRows, groupColumn]);

  useEffect(() => {
    window.localStorage.setItem("csv-viewer-page-size", String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    document.addEventListener("keydown", handleEscape);
    document.body.classList.toggle("viewer-expanded", expanded);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.classList.remove("viewer-expanded");
    };
  }, [expanded]);

  function applyRows(parsed: Cell[][], name: string, detectedLabel: string) {
    if (parsed.length === 0 || parsed[0].length === 0) {
      setError("We couldn’t find any rows in that file.");
      return;
    }
    setRows(parsed);
    setFileName(name);
    setQuery("");
    setSort(null);
    setHiddenColumns(new Set());
    setMoveColumnFrom(1);
    setMoveColumnTo(1);
    setColumnFilters({});
    setDelimiterLabel(detectedLabel);
    setShowInsights(false);
    setShowChart(false);
    setEditingCell(null);
    setUndoStack([]);
    setRedoStack([]);
    setChartLabelColumn(0);
    const firstNumeric = parsed[0].findIndex((_, index) =>
      parsed.slice(1, 100).some((row) => {
        const value = row[index];
        return value !== "" && !Number.isNaN(Number(value));
      }),
    );
    setChartValueColumn(Math.max(0, firstNumeric));
    setPage(1);
    setError("");
  }

  function loadText(text: string, name: string) {
    const cleanText = text.replace(/^\uFEFF/, "");
    const detected = detectDelimiter(cleanText);
    const parsed = parseCSV(cleanText, detected.value);
    applyRows(parsed, name, detected.label);
  }

  async function loadFiles(files: File[]) {
    if (files.length === 0) return;
    if (files.some((file) => !file.name.toLocaleLowerCase().endsWith(".csv"))) {
      setError("Please choose only .csv files.");
      return;
    }
    if (files.some((file) => file.size > 20 * 1024 * 1024)) {
      setError("Each CSV file must be smaller than 20 MB.");
      return;
    }
    setIsProcessing(true);
    setError("");
    try {
      const parsedFiles = await Promise.all(
        files.map(async (file) => parseInWorker(await file.text())),
      );
      const firstHeaders = parsedFiles[0].rows[0] ?? [];
      const compatible = parsedFiles.every(
        ({ rows: fileRows }) =>
          JSON.stringify(fileRows[0] ?? []) === JSON.stringify(firstHeaders),
      );
      if (!compatible) {
        setError("These files can’t be merged because their headers differ.");
        return;
      }
      const merged = [
        firstHeaders,
        ...parsedFiles.flatMap(({ rows: fileRows }) => fileRows.slice(1)),
      ];
      applyRows(
        merged,
        files.length === 1
          ? files[0].name
          : `${files.length}-files-merged.csv`,
        parsedFiles[0].delimiterLabel,
      );
    } catch {
      setError("The file could not be parsed. Please check its CSV formatting.");
    } finally {
      setIsProcessing(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void loadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function changeSort(column: number) {
    setSort((current) => {
      if (!current || current.column !== column)
        return { column, direction: "asc" };
      if (current.direction === "asc")
        return { column, direction: "desc" };
      return null;
    });
    setPage(1);
  }

  function toggleColumn(column: number) {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }

  function moveColumn() {
    if (headers.length < 2) return;
    const from = Math.min(headers.length, Math.max(1, moveColumnFrom)) - 1;
    const to = Math.min(headers.length, Math.max(1, moveColumnTo)) - 1;
    setMoveColumnFrom(from + 1);
    setMoveColumnTo(to + 1);
    if (from === to) return;

    setRows((current) =>
      current.map((row) => {
        const next = Array.from(
          { length: Math.max(headers.length, row.length) },
          (_, index) => row[index] ?? "",
        );
        const [column] = next.splice(from, 1);
        next.splice(to, 0, column);
        return next;
      }),
    );
    setSort(null);
    setColumnFilters({});
    setHiddenColumns(new Set());
    setEditingCell(null);
    setUndoStack([]);
    setRedoStack([]);
    setPage(1);
  }

  function download(format: ExportFormat = exportFormat) {
    const baseName = fileName.replace(/\.csv$/i, "") + "-filtered";
    const table = [headers, ...filteredRows];
    if (format === "json") {
      const objects = filteredRows.map((row) =>
        Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
      );
      downloadBlob(JSON.stringify(objects, null, 2), `${baseName}.json`, "application/json");
    } else if (format === "markdown") {
      const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
      const content = [
        `| ${headers.map(escape).join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...filteredRows.map((row) => `| ${headers.map((_, index) => escape(row[index] ?? "")).join(" | ")} |`),
      ].join("\n");
      downloadBlob(content, `${baseName}.md`, "text/markdown");
    } else if (format === "html") {
      const escape = (value: string) =>
        value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const content = `<!doctype html><meta charset="utf-8"><table><thead><tr>${headers.map((value) => `<th>${escape(value)}</th>`).join("")}</tr></thead><tbody>${filteredRows.map((row) => `<tr>${headers.map((_, index) => `<td>${escape(row[index] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      downloadBlob(content, `${baseName}.html`, "text/html");
    } else if (format === "sql") {
      const columns = headers.map((header) => `"${header.replaceAll('"', '""')}"`).join(", ");
      const content = filteredRows
        .map((row) => `INSERT INTO "csv_data" (${columns}) VALUES (${headers.map((_, index) => `'${(row[index] ?? "").replaceAll("'", "''")}'`).join(", ")});`)
        .join("\n");
      downloadBlob(content, `${baseName}.sql`, "text/sql");
    } else {
      downloadBlob(
        table.map((row) => row.map(escapeCSV).join(",")).join("\r\n"),
        `${baseName}.csv`,
        "text/csv",
      );
    }
  }

  function commitEdit() {
    if (!editingCell) return;
    const before = rows[editingCell.row]?.[editingCell.column] ?? "";
    if (before !== editingCell.value) {
      setRows((current) =>
        current.map((row, index) => {
          if (index !== editingCell.row) return row;
          const next = [...row];
          next[editingCell.column] = editingCell.value;
          return next;
        }),
      );
      setUndoStack((current) => [
        ...current,
        {
          row: editingCell.row,
          column: editingCell.column,
          before,
          after: editingCell.value,
        },
      ]);
      setRedoStack([]);
    }
    setEditingCell(null);
  }

  function applyEdit(action: EditAction, value: string) {
    setRows((current) =>
      current.map((row, index) => {
        if (index !== action.row) return row;
        const next = [...row];
        next[action.column] = value;
        return next;
      }),
    );
  }

  function undo() {
    const action = undoStack.at(-1);
    if (!action) return;
    applyEdit(action, action.before);
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, action]);
  }

  function redo() {
    const action = redoStack.at(-1);
    if (!action) return;
    applyEdit(action, action.after);
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, action]);
  }

  function applyCleaning() {
    const find = cleanFind;
    let changed = 0;
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex === 0) return row;
        const before = row[cleanColumn] ?? "";
        let after = before;
        if (cleanAction === "trim") after = before.trim();
        if (cleanAction === "upper") after = before.toLocaleUpperCase();
        if (cleanAction === "lower") after = before.toLocaleLowerCase();
        if (cleanAction === "title")
          after = before.toLocaleLowerCase().replace(/\b\p{L}/gu, (letter) =>
            letter.toLocaleUpperCase(),
          );
        if (cleanAction === "fill" && before.trim() === "") after = cleanReplacement;
        if (cleanAction === "replace" && find !== "")
          after = before.replaceAll(find, cleanReplacement);
        if (after === before) return row;
        changed += 1;
        const next = [...row];
        next[cleanColumn] = after;
        return next;
      }),
    );
    setUndoStack([]);
    setRedoStack([]);
    setToolMessage(
      changed === 0
        ? "No cells needed changing."
        : `Updated ${changed.toLocaleString()} ${changed === 1 ? "cell" : "cells"}.`,
    );
  }

  function removeDuplicates() {
    const seen = new Set<string>();
    let removed = 0;
    setRows((current) => [
      current[0],
      ...current.slice(1).filter((row) => {
        const key = JSON.stringify(row);
        if (seen.has(key)) {
          removed += 1;
          return false;
        }
        seen.add(key);
        return true;
      }),
    ]);
    setUndoStack([]);
    setRedoStack([]);
    setToolMessage(`Removed ${removed.toLocaleString()} duplicate ${removed === 1 ? "row" : "rows"}.`);
  }

  async function loadComparisonFile(file?: File) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setToolMessage("Choose a CSV file to compare.");
      return;
    }
    setIsProcessing(true);
    try {
      const result = await parseInWorker((await file.text()).replace(/^\uFEFF/, ""));
      setComparisonRows(result.rows);
      setComparisonName(file.name);
      setComparisonKey(0);
      setToolMessage(`Ready to compare with ${file.name}.`);
    } catch {
      setToolMessage("The comparison file could not be parsed.");
    } finally {
      setIsProcessing(false);
    }
  }

  function joinComparison() {
    if (!comparison) return;
    const rightByKey = new Map(
      comparison.otherData.map((row) => [row[comparisonKey] ?? "", row]),
    );
    const appendedIndexes = comparison.otherHeaders
      .map((header, index) => ({ header, index }))
      .filter(({ index }) => index !== comparisonKey);
    const joinedHeaders = [
      ...headers,
      ...appendedIndexes.map(({ header }) =>
        headers.includes(header) ? `${header} (joined)` : header,
      ),
    ];
    const joinedData = data.map((row) => {
      const match = rightByKey.get(row[primaryKey] ?? "");
      return [
        ...row,
        ...appendedIndexes.map(({ index }) => match?.[index] ?? ""),
      ];
    });
    applyRows(
      [joinedHeaders, ...joinedData],
      `${fileName.replace(/\.csv$/i, "")}-joined.csv`,
      delimiterLabel,
    );
    setShowTools(true);
    setToolTab("compare");
    setToolMessage(`Joined ${joinedData.length.toLocaleString()} rows using matching keys.`);
  }

  function exportSummary() {
    const valueHeader =
      aggregate === "count"
        ? "Count"
        : `${aggregate[0].toLocaleUpperCase()}${aggregate.slice(1)} of ${headers[aggregateColumn]}`;
    downloadBlob(
      [
        [headers[groupColumn] || "Group", valueHeader].map(escapeCSV).join(","),
        ...summaryRows.map((row) => [row.label, String(row.value)].map(escapeCSV).join(",")),
      ].join("\r\n"),
      `${fileName.replace(/\.csv$/i, "")}-summary.csv`,
      "text/csv",
    );
  }

  function reset() {
    setRows([]);
    setFileName("");
    setQuery("");
    setSort(null);
    setHiddenColumns(new Set());
    setColumnFilters({});
    setShowInsights(false);
    setShowChart(false);
    setShowTools(false);
    setComparisonRows([]);
    setComparisonName("");
    setToolMessage("");
    setEditingCell(null);
    setUndoStack([]);
    setRedoStack([]);
    setPage(1);
    setError("");
  }

  return (
    <main>
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="brand" href="#" aria-label="CSV Viewer home">
          <DataIcon />
          <span>CSV Viewer</span>
        </a>
        <a
          className="github-link"
          href="https://github.com/kiranshahi/csv-viewer"
          target="_blank"
          rel="noreferrer"
        >
          View on GitHub <span aria-hidden="true">↗</span>
        </a>
      </nav>

      {rows.length === 0 ? (
        <section className="hero">
          <p className="eyebrow">FAST · PRIVATE · OPEN SOURCE</p>
          <h1>
            See what’s inside
            <br />
            <em>your CSV.</em>
          </h1>
          <p className="intro">
            Drop in a file and explore your data instantly. Search, sort and
            scan every row—nothing ever leaves your browser.
          </p>

          <div
            className={`drop-zone ${dragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={onFileChange}
              aria-label="Choose one or more CSV files"
            />
            <div className="upload-mark" aria-hidden="true">
              ↑
            </div>
            <h2>Drop your CSV here</h2>
            <p>or choose one or more compatible files to merge</p>
            <button className="primary" onClick={() => inputRef.current?.click()}>
              {isProcessing ? "Processing…" : "Choose CSV files"}
            </button>
            <small>Up to 20 MB each · Parsed in the background · Processed locally</small>
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <button
            className="sample-link"
            onClick={() => loadText(SAMPLE, "team-directory.csv")}
          >
            No file handy? <span>Try the sample data →</span>
          </button>

          <div className="trust-row" aria-label="Key benefits">
            <p>
              <b>01</b>
              <span>
                <strong>Stays private</strong>
                Your data never leaves this device.
              </span>
            </p>
            <p>
              <b>02</b>
              <span>
                <strong>Works instantly</strong>
                No account, upload or waiting around.
              </span>
            </p>
            <p>
              <b>03</b>
              <span>
                <strong>Easy to explore</strong>
                Search, sort and export in a click.
              </span>
            </p>
          </div>

          <section className="seo-content" aria-labelledby="about-csv-viewer">
            <div className="seo-intro">
              <p className="eyebrow">EXPLORE DATA WITHOUT THE FUSS</p>
              <h2 id="about-csv-viewer">A free online CSV viewer that stays private</h2>
              <p>
                CSV Viewer lets you open comma-separated value files directly
                in your web browser. There is no software to install, no account
                to create and no file upload to wait for. Your data is read and
                processed locally on your device.
              </p>
            </div>

            <div className="seo-grid">
              <article>
                <span>SEARCH &amp; SORT</span>
                <h3>Find the rows you need</h3>
                <p>
                  Search across every column, sort values in either direction
                  and move through large CSV tables with simple pagination.
                </p>
              </article>
              <article>
                <span>CUSTOMISE THE VIEW</span>
                <h3>Focus on useful columns</h3>
                <p>
                  Hide columns, expand the table to fill your screen or show all
                  matching rows at once without changing the original file.
                </p>
              </article>
              <article>
                <span>EXPORT RESULTS</span>
                <h3>Download filtered data</h3>
                <p>
                  Export your current filtered result as a new CSV file while
                  keeping every original column available.
                </p>
              </article>
            </div>

            <div className="how-it-works">
              <h2>How to view a CSV file online</h2>
              <ol>
                <li>
                  <b>1</b>
                  <span><strong>Choose a CSV file</strong>Drop a file onto the viewer or select one from your device.</span>
                </li>
                <li>
                  <b>2</b>
                  <span><strong>Explore your table</strong>Search, sort, hide columns and adjust the number of visible rows.</span>
                </li>
                <li>
                  <b>3</b>
                  <span><strong>Export when ready</strong>Download the filtered result or simply close the page.</span>
                </li>
              </ol>
            </div>

            <div className="faq">
              <h2>CSV Viewer questions</h2>
              <details>
                <summary>Is this CSV viewer free?</summary>
                <p>Yes. The tool is free to use and does not require an account.</p>
              </details>
              <details>
                <summary>Are CSV files uploaded to a server?</summary>
                <p>
                  No. Files are processed locally by your browser and never
                  leave your device.
                </p>
              </details>
              <details>
                <summary>Can I open large CSV files?</summary>
                <p>
                  The viewer supports CSV files up to 20 MB and includes
                  pagination to keep large tables manageable.
                </p>
              </details>
            </div>
          </section>
        </section>
      ) : (
        <section className={`viewer ${expanded ? "is-expanded" : ""}`}>
          <div className="viewer-heading">
            <div>
              <p className="eyebrow">YOUR DATA</p>
              <h1>{fileName}</h1>
              <p>
                {data.length.toLocaleString()} rows ·{" "}
                {headers.length.toLocaleString()} columns · {delimiterLabel}{" "}
                delimiter
              </p>
            </div>
            <div className="viewer-actions">
              <button
                className="secondary history-button"
                onClick={undo}
                disabled={undoStack.length === 0}
                title="Undo last cell edit"
              >
                ↶ Undo
              </button>
              <button
                className="secondary history-button"
                onClick={redo}
                disabled={redoStack.length === 0}
                title="Redo last cell edit"
              >
                ↷ Redo
              </button>
              <button
                className="secondary expand-button"
                onClick={() => setExpanded((value) => !value)}
                aria-pressed={expanded}
                title={expanded ? "Exit expanded view (Esc)" : "Expand viewer"}
              >
                <span aria-hidden="true">{expanded ? "↙" : "↗"}</span>
                {expanded ? "Collapse" : "Expand"}
              </button>
              <button className="secondary" onClick={reset}>
                Open another
              </button>
              <div className="export-control">
                <select
                  aria-label="Export format"
                  value={exportFormat}
                  onChange={(event) =>
                    setExportFormat(event.target.value as ExportFormat)
                  }
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                  <option value="sql">SQL</option>
                </select>
                <button className="primary compact" onClick={() => download()}>
                  Export
                </button>
              </div>
            </div>
          </div>

          <div className="table-toolbar">
            <label className="search">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search every column…"
              />
            </label>
            <div className="toolbar-options">
              <p>
                Showing <strong>{filteredRows.length.toLocaleString()}</strong>{" "}
                of {data.length.toLocaleString()} rows
              </p>
              {activeFilterCount > 0 && (
                <button
                  className="clear-filters"
                  onClick={() => setColumnFilters({})}
                >
                  Clear {activeFilterCount}{" "}
                  {activeFilterCount === 1 ? "filter" : "filters"}
                </button>
              )}
              <button
                className={`insights-button ${showInsights ? "is-active" : ""}`}
                onClick={() => setShowInsights((value) => !value)}
                aria-pressed={showInsights}
              >
                <span aria-hidden="true">◫</span>
                Data profile
              </button>
              <button
                className={`insights-button ${showChart ? "is-active" : ""}`}
                onClick={() => setShowChart((value) => !value)}
                aria-pressed={showChart}
              >
                <span aria-hidden="true">▥</span>
                Chart
              </button>
              <button
                className={`insights-button ${showTools ? "is-active" : ""}`}
                onClick={() => setShowTools((value) => !value)}
                aria-pressed={showTools}
              >
                <span aria-hidden="true">✦</span>
                Data tools
              </button>
              <details className="columns-menu">
                <summary>
                  <span aria-hidden="true">▥</span>
                  Columns
                  {hiddenColumns.size > 0 && <b>{hiddenColumns.size}</b>}
                </summary>
                <div className="columns-popover">
                  <div className="columns-popover-heading">
                    <strong>Visible columns</strong>
                    {hiddenColumns.size > 0 && (
                      <button onClick={() => setHiddenColumns(new Set())}>
                        Show all
                      </button>
                    )}
                  </div>
                  {headers.length > 1 && (
                    <div className="column-ordering">
                      <strong>Change order</strong>
                      <div>
                        <label>
                          From
                          <input
                            type="number"
                            min={1}
                            max={headers.length}
                            value={moveColumnFrom}
                            onChange={(event) =>
                              setMoveColumnFrom(Number(event.target.value))
                            }
                            aria-label="Column position to move"
                          />
                        </label>
                        <span aria-hidden="true">→</span>
                        <label>
                          To
                          <input
                            type="number"
                            min={1}
                            max={headers.length}
                            value={moveColumnTo}
                            onChange={(event) =>
                              setMoveColumnTo(Number(event.target.value))
                            }
                            aria-label="New column position"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={moveColumn}
                          disabled={moveColumnFrom === moveColumnTo}
                        >
                          Move
                        </button>
                      </div>
                      <small>Positions run from 1 to {headers.length}.</small>
                    </div>
                  )}
                  {headers.map((header, index) => (
                    <label key={`${header}-${index}`}>
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.has(index)}
                        onChange={() => toggleColumn(index)}
                      />
                      <span>{header || `Column ${index + 1}`}</span>
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>

          {showTools && (
            <section className="tools-panel" aria-labelledby="tools-heading">
              <div className="tools-heading">
                <div>
                  <p className="eyebrow">TRANSFORM &amp; ANALYSE</p>
                  <h2 id="tools-heading">Data tools</h2>
                </div>
                <div className="tool-tabs" role="tablist" aria-label="Data tools">
                  {(["clean", "compare", "summary"] as ToolTab[]).map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={toolTab === tab}
                      className={toolTab === tab ? "is-active" : ""}
                      onClick={() => {
                        setToolTab(tab);
                        setToolMessage("");
                      }}
                    >
                      {tab === "clean" ? "Clean" : tab === "compare" ? "Compare & join" : "Summarize"}
                    </button>
                  ))}
                </div>
              </div>

              {toolTab === "clean" && (
                <div className="tool-workspace">
                  <label>
                    Column
                    <select value={cleanColumn} onChange={(event) => setCleanColumn(Number(event.target.value))}>
                      {headers.map((header, index) => (
                        <option key={`clean-${index}`} value={index}>{header || `Column ${index + 1}`}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Action
                    <select value={cleanAction} onChange={(event) => setCleanAction(event.target.value as CleanAction)}>
                      <option value="trim">Trim whitespace</option>
                      <option value="upper">UPPERCASE</option>
                      <option value="lower">lowercase</option>
                      <option value="title">Title Case</option>
                      <option value="fill">Fill empty cells</option>
                      <option value="replace">Find and replace</option>
                    </select>
                  </label>
                  {cleanAction === "replace" && (
                    <label>
                      Find
                      <input value={cleanFind} onChange={(event) => setCleanFind(event.target.value)} placeholder="Text to find" />
                    </label>
                  )}
                  {(cleanAction === "replace" || cleanAction === "fill") && (
                    <label>
                      {cleanAction === "fill" ? "Fill with" : "Replace with"}
                      <input value={cleanReplacement} onChange={(event) => setCleanReplacement(event.target.value)} placeholder="New value" />
                    </label>
                  )}
                  <button className="primary compact" onClick={applyCleaning}>Apply to column</button>
                  <button className="secondary compact" onClick={removeDuplicates}>Remove duplicate rows</button>
                </div>
              )}

              {toolTab === "compare" && (
                <div className="compare-workspace">
                  <input
                    ref={compareInputRef}
                    className="sr-only"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      void loadComparisonFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <div className="compare-file">
                    <div>
                      <strong>{comparisonName || "Choose a second CSV"}</strong>
                      <span>Compare changes or join columns by a shared key.</span>
                    </div>
                    <button className="secondary compact" onClick={() => compareInputRef.current?.click()}>
                      {comparisonName ? "Replace file" : "Choose file"}
                    </button>
                  </div>
                  {comparison && (
                    <>
                      <div className="compare-keys">
                        <label>
                          Key in {fileName}
                          <select value={primaryKey} onChange={(event) => setPrimaryKey(Number(event.target.value))}>
                            {headers.map((header, index) => <option key={`primary-${index}`} value={index}>{header || `Column ${index + 1}`}</option>)}
                          </select>
                        </label>
                        <span aria-hidden="true">↔</span>
                        <label>
                          Key in {comparisonName}
                          <select value={comparisonKey} onChange={(event) => setComparisonKey(Number(event.target.value))}>
                            {comparison.otherHeaders.map((header, index) => <option key={`other-${index}`} value={index}>{header || `Column ${index + 1}`}</option>)}
                          </select>
                        </label>
                        <button className="primary compact" onClick={joinComparison}>Left join files</button>
                      </div>
                      <div className="compare-results">
                        <article><strong>{comparison.added.toLocaleString()}</strong><span>Added keys</span></article>
                        <article><strong>{comparison.removed.toLocaleString()}</strong><span>Removed keys</span></article>
                        <article><strong>{comparison.changed.toLocaleString()}</strong><span>Changed rows</span></article>
                        <article><strong>{comparison.unchanged.toLocaleString()}</strong><span>Unchanged rows</span></article>
                      </div>
                    </>
                  )}
                </div>
              )}

              {toolTab === "summary" && (
                <div className="summary-workspace">
                  <div className="summary-controls">
                    <label>
                      Group by
                      <select value={groupColumn} onChange={(event) => setGroupColumn(Number(event.target.value))}>
                        {headers.map((header, index) => <option key={`group-${index}`} value={index}>{header || `Column ${index + 1}`}</option>)}
                      </select>
                    </label>
                    <label>
                      Calculation
                      <select value={aggregate} onChange={(event) => setAggregate(event.target.value as Aggregate)}>
                        <option value="count">Count rows</option>
                        <option value="sum">Sum</option>
                        <option value="average">Average</option>
                        <option value="min">Minimum</option>
                        <option value="max">Maximum</option>
                      </select>
                    </label>
                    {aggregate !== "count" && (
                      <label>
                        Value column
                        <select value={aggregateColumn} onChange={(event) => setAggregateColumn(Number(event.target.value))}>
                          {numericColumns.map((stat) => <option key={`aggregate-${stat.index}`} value={stat.index}>{stat.name}</option>)}
                        </select>
                      </label>
                    )}
                    <button className="secondary compact" onClick={exportSummary}>Export summary</button>
                  </div>
                  <div className="summary-table">
                    <table>
                      <thead><tr><th>{headers[groupColumn] || "Group"}</th><th>{aggregate === "count" ? "Count" : aggregate}</th></tr></thead>
                      <tbody>
                        {summaryRows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {toolMessage && <p className="tool-message" role="status">{toolMessage}</p>}
            </section>
          )}

          {showInsights && (
            <section className="insights-panel" aria-labelledby="profile-heading">
              <div className="insights-heading">
                <div>
                  <p className="eyebrow">DATA QUALITY</p>
                  <h2 id="profile-heading">Column profile</h2>
                </div>
                <div className="quality-summary">
                  <span>
                    <strong>{data.length.toLocaleString()}</strong> rows
                  </span>
                  <span>
                    <strong>{headers.length.toLocaleString()}</strong> columns
                  </span>
                  <span className={duplicateRows > 0 ? "has-warning" : ""}>
                    <strong>{duplicateRows.toLocaleString()}</strong> duplicate{" "}
                    {duplicateRows === 1 ? "row" : "rows"}
                  </span>
                  <span className={validation.unevenRows > 0 ? "has-warning" : ""}>
                    <strong>{validation.unevenRows.toLocaleString()}</strong>{" "}
                    uneven rows
                  </span>
                  <span className={validation.duplicateHeaders > 0 ? "has-warning" : ""}>
                    <strong>{validation.duplicateHeaders.toLocaleString()}</strong>{" "}
                    duplicate headers
                  </span>
                  <span className={validation.missingCells > 0 ? "has-warning" : ""}>
                    <strong>{validation.missingCells.toLocaleString()}</strong>{" "}
                    missing cells
                  </span>
                </div>
              </div>
              <div className="stat-grid">
                {columnStats.map((stat) => (
                  <article key={`${stat.name}-${stat.index}`}>
                    <div>
                      <h3 title={stat.name}>{stat.name}</h3>
                      <span className={`type-badge type-${stat.type.toLowerCase()}`}>
                        {stat.type}
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>Unique</dt>
                        <dd>{stat.unique.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Missing</dt>
                        <dd className={stat.missing > 0 ? "has-warning" : ""}>
                          {stat.missing.toLocaleString()}
                        </dd>
                      </div>
                      {stat.minimum !== undefined && (
                        <div>
                          <dt>Min</dt>
                          <dd title={stat.minimum}>{stat.minimum}</dd>
                        </div>
                      )}
                      {stat.maximum !== undefined && (
                        <div>
                          <dt>Max</dt>
                          <dd title={stat.maximum}>{stat.maximum}</dd>
                        </div>
                      )}
                      {stat.average !== undefined && (
                        <div>
                          <dt>Average</dt>
                          <dd>{stat.average}</dd>
                        </div>
                      )}
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          )}

          {showChart && (
            <section className="chart-panel" aria-labelledby="chart-heading">
              <div className="chart-toolbar">
                <div>
                  <p className="eyebrow">QUICK VISUAL</p>
                  <h2 id="chart-heading">Chart filtered data</h2>
                </div>
                <label>
                  Labels
                  <select
                    value={chartLabelColumn}
                    onChange={(event) => setChartLabelColumn(Number(event.target.value))}
                  >
                    {headers.map((header, index) => (
                      <option key={`label-${index}`} value={index}>
                        {header || `Column ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Values
                  <select
                    value={chartValueColumn}
                    onChange={(event) => setChartValueColumn(Number(event.target.value))}
                  >
                    {numericColumns.map((stat) => (
                      <option key={`value-${stat.index}`} value={stat.index}>
                        {stat.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Style
                  <select
                    value={chartType}
                    onChange={(event) =>
                      setChartType(event.target.value as "bar" | "line")
                    }
                  >
                    <option value="bar">Bars</option>
                    <option value="line">Dot plot</option>
                  </select>
                </label>
              </div>
              {numericColumns.length === 0 ? (
                <p className="chart-empty">
                  Add a numeric column to create a chart.
                </p>
              ) : chartRows.length === 0 ? (
                <p className="chart-empty">No numeric rows match the filters.</p>
              ) : (
                <div className={`quick-chart chart-${chartType}`}>
                  {chartRows.map((item, index) => (
                    <div className="chart-item" key={`${item.label}-${index}`}>
                      <span className="chart-value">{item.value.toLocaleString()}</span>
                      <i
                        style={{
                          height: `${Math.max(3, (Math.abs(item.value) / chartMaximum) * 100)}%`,
                        }}
                      />
                      <span className="chart-label" title={item.label}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {chartRows.length > 30 && (
                <small>Showing the first 30 matching rows.</small>
              )}
            </section>
          )}

          <div
            className={`table-shell ${virtualize ? "is-virtualized" : ""}`}
            onScroll={(event) => {
              if (virtualize) setScrollTop(event.currentTarget.scrollTop);
            }}
          >
            <table>
              <thead>
                <tr>
                  <th className="row-number">#</th>
                  {visibleColumns.map(({ header, index }) => (
                    <th key={`${header}-${index}`}>
                      <button onClick={() => changeSort(index)}>
                        {header || `Column ${index + 1}`}
                        <span
                          className={
                            sort?.column === index ? "sort active" : "sort"
                          }
                          aria-hidden="true"
                        >
                          {sort?.column === index
                            ? sort.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="filter-row">
                  <th className="row-number" aria-label="Column filters">
                    {activeFilterCount > 0 ? "●" : ""}
                  </th>
                  {visibleColumns.map(({ header, index }) => (
                    <th key={`filter-${header}-${index}`}>
                      <label>
                        <span className="sr-only">
                          Filter {header || `Column ${index + 1}`}
                        </span>
                        <select
                          aria-label={`Filter operator for ${header || `Column ${index + 1}`}`}
                          value={columnFilters[index]?.operator ?? "contains"}
                          onChange={(event) => {
                            const current = columnFilters[index];
                            setColumnFilters((filters) => ({
                              ...filters,
                              [index]: {
                                operator: event.target.value as FilterOperator,
                                value: current?.value ?? "",
                                valueTo: current?.valueTo ?? "",
                              },
                            }));
                            setPage(1);
                          }}
                        >
                          <option value="contains">Contains</option>
                          <option value="equals">Equals</option>
                          <option value="starts">Starts with</option>
                          <option value="empty">Is empty</option>
                          <option value="not-empty">Is not empty</option>
                          {columnStats[index]?.type === "Number" && (
                            <>
                              <option value="greater">Greater than</option>
                              <option value="less">Less than</option>
                              <option value="between">Between</option>
                            </>
                          )}
                        </select>
                        <input
                          value={columnFilters[index]?.value ?? ""}
                          disabled={["empty", "not-empty"].includes(columnFilters[index]?.operator ?? "")}
                          onChange={(event) => {
                            const value = event.target.value;
                            setColumnFilters((current) => ({
                              ...current,
                              [index]: {
                                operator: current[index]?.operator ?? "contains",
                                value,
                                valueTo: current[index]?.valueTo ?? "",
                              },
                            }));
                            setPage(1);
                          }}
                          placeholder="Filter…"
                        />
                        {columnFilters[index]?.operator === "between" && (
                          <input
                            aria-label={`Maximum value for ${header || `Column ${index + 1}`}`}
                            value={columnFilters[index]?.valueTo ?? ""}
                            onChange={(event) =>
                              setColumnFilters((current) => ({
                                ...current,
                                [index]: {
                                  operator: "between",
                                  value: current[index]?.value ?? "",
                                  valueTo: event.target.value,
                                },
                              }))
                            }
                            placeholder="and…"
                          />
                        )}
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topSpacer > 0 && (
                  <tr className="virtual-spacer" aria-hidden="true">
                    <td style={{ height: topSpacer }} colSpan={visibleColumns.length + 1} />
                  </tr>
                )}
                {visibleRows.map((row, rowIndex) => (
                  <tr key={`${currentPage}-${virtualStart + rowIndex}-${row.join("|")}`}>
                    <td className="row-number">
                      {pageSize === 0
                        ? virtualStart + rowIndex + 1
                        : (currentPage - 1) * pageSize + rowIndex + 1}
                    </td>
                    {visibleColumns.map(({ index }) => {
                      const sourceRow = rows.indexOf(row);
                      const isEditing =
                        editingCell?.row === sourceRow &&
                        editingCell.column === index;
                      return (
                      <td
                        key={index}
                        title={isEditing ? undefined : row[index] ?? ""}
                        onDoubleClick={() =>
                          setEditingCell({
                            row: sourceRow,
                            column: index,
                            value: row[index] ?? "",
                          })
                        }
                      >
                        {isEditing ? (
                          <input
                            className="cell-editor"
                            autoFocus
                            value={editingCell.value}
                            onChange={(event) =>
                              setEditingCell({
                                ...editingCell,
                                value: event.target.value,
                              })
                            }
                            onBlur={commitEdit}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitEdit();
                              if (event.key === "Escape") setEditingCell(null);
                            }}
                          />
                        ) : (
                          row[index] || <span className="empty">—</span>
                        )}
                      </td>
                      );
                    })}
                  </tr>
                ))}
                {bottomSpacer > 0 && (
                  <tr className="virtual-spacer" aria-hidden="true">
                    <td style={{ height: bottomSpacer }} colSpan={visibleColumns.length + 1} />
                  </tr>
                )}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      className="no-results"
                      colSpan={visibleColumns.length + 1}
                    >
                      No rows match “{query}”
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <label>
              Rows per page
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="0">All</option>
              </select>
            </label>
            <div>
              <button
                aria-label="Previous page"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={currentPage === 1}
              >
                ←
              </button>
              <span>
                Page {currentPage} of {pageCount}
              </span>
              <button
                aria-label="Next page"
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
                disabled={currentPage === pageCount}
              >
                →
              </button>
            </div>
          </div>
        </section>
      )}

      <footer>
        Built for curious minds. <span>CSV Viewer · 2026</span>
      </footer>
    </main>
  );
}
