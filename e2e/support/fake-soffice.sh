#!/usr/bin/env bash
# Stands in for LibreOffice in the e2e run (CMM_SOFFICE_PATH): `--version` answers like soffice,
# and `--convert-to pdf --outdir <dir> <file>` writes a one-page PDF to <dir>/<file name>.pdf, or
# fails like LibreOffice on a file that contains "not a document".
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  echo "LibreOffice 24.2.0.1 (e2e stand-in)"
  exit 0
fi
outdir=""
input=""
while [ $# -gt 0 ]; do
  case "$1" in
    --outdir) outdir="$2"; shift 2 ;;
    -*) shift ;;
    *) input="$1"; shift ;;
  esac
done
[ -n "$outdir" ] && [ -n "$input" ] || exit 2
# CMM converts a copy named input.<ext>, so a damaged file is recognized by its content.
if grep -q "not a document" "$input"; then exit 1; fi
name="$(basename "$input")"
cat >"$outdir/${name%.*}.pdf" <<'PDF'
%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 58 >> stream
BT /F1 18 Tf 20 100 Td (Converted by LibreOffice) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF
PDF
