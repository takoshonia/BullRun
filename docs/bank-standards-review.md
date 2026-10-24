# TBC and Bank of Georgia: standards and draft checks

Checked against public documentation on 24 October 2026. Public documents demonstrate published interfaces; they do not certify any bank's deployed behavior or prove that every customer integration uses the same version.

## Published interfaces

- **TBC payment-account AIS:** the official [Read Account List](https://developers.tbcbank.ge/reference/aisreadaccountlist) documents `https://test-openbanking.tbcbank.ge/0.8/v1/accounts`. Its [AIS overview](https://developers.tbcbank.ge/reference/aisapioverview) describes consent, OAuth access tokens, and JWS signing. Its separate [loans/savings overview](https://developers.tbcbank.ge/reference/api-overview-loans) must not be treated as the same account profile. The public overview alone does not establish an exact Open Finance framework release for every TBC service.
- **BOG legacy Open Banking V1:** the official [OpenAPI contract](https://api.bog.ge/docs/en/openapi/openbanking.yaml) is titled **NextGenPSD2 XS2A Framework**, API version **0.8**, and describes underlying Framework **1.3.9**. It declares the sandbox server `https://xs2a-sandbox.bog.ge/0.8` and account-list path `/v1/accounts`. API version 0.8 and underlying framework version 1.3.9 refer to different version layers.
- **BOG newer AIS:** the separately published [Open Finance AIS contract](https://api.bog.ge/docs/en/openapi/BG_oFA_AIS_recent.openapi.yaml) identifies **openFinance API Framework XS2A API as PSD2 Interface Implementation Guidelines - Account Information Service**, version **2.3**, and `/v2/accounts`. This is a separate contract, not a reason to silently change the current legacy mock profiles. The [official index](https://api.bog.ge/docs/en/llms.txt) links legacy, AIS, PIS, XAIS and XPIS contracts independently.

BOG document digests, titles, version fields and declared servers are pinned in [bank-standard-provenance.json](bank-standard-provenance.json). These are retrieval-time references; do not silently refresh an approved rule from a changed remote document.

## Georgian normative documents

The [Banking Association standards page](https://openfinance.ge/en/standards) lists these legacy documents and also links an updated standards repository:

1. **XS2A Standard Implementation Guide 0.8.RC3 (Geo)** — payment-account AIS and PIS implementation requirements.
2. **Identification, Authentication and Authorization manual 0.8.RC1 (Geo)** — authentication and authorization requirements.
3. **JSON Web Signature (JWS) implementation guide in the Open Finance system**, **0.5.RC1** — the [version linked by TBC](https://cdn.association.ge/static/openbanking/standards/pdf/OpenFinance_Json_Web_Signature_Profile_0.5.RC1.pdf).

The six new rules use the already supplied `sources/XS2A-0.8.RC3.txt`, section **9.3.3, GET /v1/accounts**, rather than mixing legacy payment accounts with newer loan/deposit requirements. Each record pins the full local source hash, the exact table row, bank documentation references, retrieval date, and applicability note.

## Exact draft names for review

| Rule ID | Exact title | Source row |
|---|---|---|
| XS2A-ACCOUNT-IBAN | Payment-account list: IBAN is required | iban / IBAN / mandatory |
| XS2A-ACCOUNT-CURRENCY | Payment-account list: currency is required | currency / Currency Code / mandatory |
| XS2A-ACCOUNT-TYPE | Payment-account list: cashAccountType is required | cashAccountType / Cash Account Type / mandatory |
| XS2A-ACCOUNT-BIC | Payment-account list: BIC is required | bic / BICFI / mandatory |
| XS2A-ACCOUNT-NO-BBAN | Payment-account list: bban must be omitted | bban / BBAN / prohibited |
| XS2A-ACCOUNT-NO-LINKED | Payment-account list: linkedAccounts must be omitted | linkedAccounts / Max70Text / prohibited |

All start as **draft**. An existing record is never overwritten, including its approval, reviewer note or pinned source hash. Only an Operator or Standards reviewer can approve, using the existing review endpoint and explicit source-review confirmation.

Review in **Standards & rules → Rules and review status → Inspect**. Read the complete source row and surrounding conditions, confirm the exact assigned bank service/profile, enter an applicability note and choose **Approve rule**. These drafts are not automatically approved or executed during seeding.

Implemented assertions cover field presence/omission and basic syntax in successful account-list responses. They do not validate IBAN checksums, currency/BIC directories, bank registration, account classifications, consent completeness, cryptographic signatures or overall compliance. Empty lists and non-success responses do not count as passing field evidence. OpenAPI-only reviews report these checks as not assessed until actual response evidence is supplied.

`resourceId` is intentionally not made an unconditional new rule: the table makes it conditional for addressable versus accessible accounts. `product` is optional in the account-list table even though it is mandatory in the account-details table. CACC/CARD are recommendations in this table; the new account-type check does not turn them into a hard whitelist.

The project's TBC and BOG adapters connect independent synthetic mocks. Their legacy `xs2a-0.8` profile is a declared test scope, not proof of the actual banks' conformance or their only current API generation.
