// "Show as table" view for every radar chart (Stage 8), so no value is only
// available by hovering or by reading a bar length. Runs in the BROWSER.

type DataTableProps = {
  caption: string;
  columns: [string, string];
  rows: { label: string; value: number }[];
};

export function DataTable({ caption, columns, rows }: DataTableProps) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium text-accent">Show as table</summary>
      <table className="mt-2 w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-ink-muted">
            <th scope="col" className="py-1 pr-2 font-medium">{columns[0]}</th>
            <th scope="col" className="py-1 text-right font-medium">{columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line/60">
              <th scope="row" className="py-1 pr-2 text-left font-normal text-ink">{row.label}</th>
              <td className="py-1 text-right text-ink tabular-nums">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
