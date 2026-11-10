# Membership identity

Approved product scope: $10/month is PenEcho Plus; $20/month is PenEcho Pro. Dashboard account name and client Cloud Profile show PLUS/PRO. The client toolbar button stays unchanged. Profile shows the paid subscription period end as a localized date, with no time. Top-ups never establish membership.

Design source map:
- Client account card → penecho_design/penecho-design-language.html settings/complete surfaces → preserve existing compact opaque group, name hierarchy and secondary metadata.
- Dashboard account identity → existing console account-trigger/who → keep avatar, name and email; add metadata beside name.
- Billing cards → existing billing settings source map and catalog settings/buttons → retain layout, prices, credits and actions; add plan names.
- New membership badge → user-approved addition filling a catalog gap: compact rounded text label, 10.5px/600, 2px × 7px inset, 6px radius; neutral Plus and muted sage Pro. Names remain the authoritative differentiator. Add this example to the canonical catalog when integrating design changes.

Implementation uses the product's existing light workbench surfaces. Expiry and badge are removed when membership is missing, invalid or elapsed. Long names wrap in the client; Dashboard retains its existing accessible full name text and truncation behavior. No payment or subscription action is added.
