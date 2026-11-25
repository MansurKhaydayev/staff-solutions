-- arbeitgeber_offen_hinweise nur für angemeldete Personen (wie die übrigen Funktionen; Sicherheitshinweis 0028)
revoke execute on function public.arbeitgeber_offen_hinweise() from public, anon;
grant execute on function public.arbeitgeber_offen_hinweise() to authenticated;
