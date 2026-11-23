import { useState } from 'react';
import type { ExportResult } from '@glidepath/api-contract';
import { Grid } from '@glidepath/ui/glass';
import { ExportPanel } from './ExportPanel';
import { ImportPanel } from './ImportPanel';
import { excelCss } from './styles';

/**
 * Excel · "Excel round trip" (MOD-09; UX 03_screens, data-dark-1440.jpg). Export and import
 * review over the Excel routes of tier 2 (API-10); no workbook is read or compared here.
 */
export default function Excel() {
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);
  return (
    <main className="gp-module" data-module="excel" aria-label="Excel">
      <style href="glidepath-web-excel" precedence="glidepath">
        {excelCss}
      </style>
      <Grid>
        <ExportPanel onExported={setLastExport} />
        <ImportPanel lastExport={lastExport} />
      </Grid>
    </main>
  );
}
