# Customer Insight: Cloudflare-only migration

This package moves the `database_customer_insight` runtime away from BigQuery.
BigQuery is used only as the read-only source during the resumable copy.

## Source inventory (audited 2026-09-24)

| Source table | Rows | Cloudflare table |
| --- | ---: | --- |
| `Data Member` | 241,011 | `members` |
| `Detail Transaksi` | 1,207,582 | `transactions` |
| `Pax_Promotion` | 115,605 | `pax_promotions` |
| `Customer_Dashboard_Summary` | 298,869 | `customer_summary` |

The BigQuery routine `Refresh_Customer_Dashboard_Summary` was audited and its
materialized output is represented by the indexed `customer_summary` table.

## Deployment order

1. D1 database `bakerzin-customer-insight` is ready in APAC with ID
   `779f5173-9ac0-45ae-a683-b2bef0d06874`.
2. Apply `migrations/0001_customer_insight.sql` remotely.
3. Add Worker secret `API_KEY`, then deploy the Worker.
4. Add `apps-script/ZZ_CloudflareCustomerInsight.gs` to Apps Script project
   `CSR` (`1GPpHVTzUmWzSk6LFyDm5VEOqDbGXwyv0QrfK3s4_dRxe_-AJtE_Mxaet`).
5. Set Apps Script properties `CLOUDFLARE_CUSTOMER_INSIGHT_URL` and
   `CLOUDFLARE_CUSTOMER_INSIGHT_API_KEY`.
6. Run `testCloudflareCustomerInsight()`.
7. Run `startCustomerInsightCloudflareMigration()` once. Check progress with
   `getCustomerInsightCloudflareMigrationStatus()`.

Runtime functions `searchCustomers`, `loadCustomerDashboard`,
`updateCustomerPhone`, and `getGroupSingleVisitorType` are overridden to call
Cloudflare only. They deliberately contain no BigQuery fallback.
