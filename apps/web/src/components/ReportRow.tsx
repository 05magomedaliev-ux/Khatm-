import type { ReportView } from '@khatm/shared';
import { formatDate, reportScope } from '../lib/format';

export function ReportRow({ report, onOpen }: { report: ReportView; onOpen(report: ReportView): void }) {
  return (
    <button type="button" className="report-row" onClick={() => onOpen(report)}>
      <span className="seal seal-plain">{report.memberName.slice(0, 1)}</span>
      <span className="report-main">
        <strong>{report.memberName}</strong>
        <small>
          {reportScope(report)}
          {report.edited ? ', изменён' : ''}
        </small>
      </span>
      <span className="report-side">
        <strong>{report.pages} стр.</strong>
        <small>{formatDate(report.readOn)}</small>
      </span>
    </button>
  );
}
