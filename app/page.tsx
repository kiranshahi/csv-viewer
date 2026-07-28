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
  const [pageSize, setPageSize] = useState(10);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(new Set());
  const [columnFilters, setColumnFilters] = useState<Record<number, string>>({});
  const [delimiterLabel, setDelimiterLabel] = useState("Comma");
  const [showInsights, setShowInsights] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const headers = rows[0] ?? [];
  const data = rows.slice(1);
  const visibleColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ index }) => !hiddenColumns.has(index));

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const activeColumnFilters = Object.entries(columnFilters).filter(
      ([, value]) => value.trim() !== "",
    );
    const filtered = data.filter((row) => {
      const matchesSearch =
        !normalized ||
        row.some((value) => value.toLocaleLowerCase().includes(normalized));
      const matchesColumns = activeColumnFilters.every(([column, value]) =>
        (row[Number(column)] ?? "")
          .toLocaleLowerCase()
          .includes(value.trim().toLocaleLowerCase()),
      );
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

  const activeFilterCount = Object.values(columnFilters).filter(
    (value) => value.trim() !== "",
  ).length;

  const pageCount =
    pageSize === 0
      ? 1
      : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows =
    pageSize === 0
      ? filteredRows
      : filteredRows.slice(
          (currentPage - 1) * pageSize,
          currentPage * pageSize,
        );

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

  function loadText(text: string, name: string) {
    const cleanText = text.replace(/^\uFEFF/, "");
    const detected = detectDelimiter(cleanText);
    const parsed = parseCSV(cleanText, detected.value);
    if (parsed.length === 0 || parsed[0].length === 0) {
      setError("We couldn’t find any rows in that file.");
      return;
    }
    setRows(parsed);
    setFileName(name);
    setQuery("");
    setSort(null);
    setHiddenColumns(new Set());
    setColumnFilters({});
    setDelimiterLabel(detected.label);
    setShowInsights(false);
    setPage(1);
    setError("");
  }

  async function loadFile(file?: File) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Please choose a CSV file smaller than 20 MB.");
      return;
    }
    loadText(await file.text(), file.name);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
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

  function download() {
    const content = [headers, ...filteredRows]
      .map((row) => row.map(escapeCSV).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.replace(/\.csv$/i, "") + "-filtered.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setRows([]);
    setFileName("");
    setQuery("");
    setSort(null);
    setHiddenColumns(new Set());
    setColumnFilters({});
    setShowInsights(false);
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
              onChange={onFileChange}
              aria-label="Choose a CSV file"
            />
            <div className="upload-mark" aria-hidden="true">
              ↑
            </div>
            <h2>Drop your CSV here</h2>
            <p>or choose a file from your computer</p>
            <button className="primary" onClick={() => inputRef.current?.click()}>
              Choose CSV file
            </button>
            <small>Up to 20 MB · Processed locally</small>
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
              <button className="primary compact" onClick={download}>
                Export filtered CSV
              </button>
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

          <div className="table-shell">
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
                        <input
                          value={columnFilters[index] ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setColumnFilters((current) => ({
                              ...current,
                              [index]: value,
                            }));
                            setPage(1);
                          }}
                          placeholder="Filter…"
                        />
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr key={`${currentPage}-${rowIndex}-${row.join("|")}`}>
                    <td className="row-number">
                      {pageSize === 0
                        ? rowIndex + 1
                        : (currentPage - 1) * pageSize + rowIndex + 1}
                    </td>
                    {visibleColumns.map(({ index }) => (
                      <td key={index} title={row[index] ?? ""}>
                        {row[index] || <span className="empty">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
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
