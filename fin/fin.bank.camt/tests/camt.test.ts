import { assertEquals, assertThrows } from "@std/assert";

import { parse } from "../mod.ts";

const statement = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
  <BkToCstmrStmt>
    <Stmt>
      <Id>STMT-2026-10-07</Id>
      <Acct><Id><IBAN>CH5604835012345678009</IBAN></Id><Ccy>CHF</Ccy></Acct>
      <Ntry>
        <Amt Ccy="CHF">600.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-10-07</Dt></BookgDt>
        <AcctSvcrRef>ENTRY-1</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>TX-1</AcctSvcrRef><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
            <Amt Ccy="CHF">472.26</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <RltdPties><Dbtr><Nm>Kunde &amp; Co</Nm></Dbtr><DbtrAcct><Id><IBAN>CH93 0076 2011 6238 5295 7</IBAN></Id></DbtrAcct></RltdPties>
            <RmtInf><Strd><CdtrRefInf><Ref>210000000003139471430009017</Ref></CdtrRefInf></Strd></RmtInf>
          </TxDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>TX-2</AcctSvcrRef></Refs>
            <Amt Ccy="CHF">127.74</Amt>
            <RltdPties><Dbtr><Pty><Nm>Muster AG</Nm></Pty></Dbtr></RltdPties>
            <RmtInf><Ustrd>Rechnung 2026-4</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">120.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><DtTm>2026-10-08T09:12:00</DtTm></BookgDt>
        <AcctSvcrRef>ENTRY-2</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>fin-payment-12</EndToEndId></Refs>
          <RltdPties><Cdtr><Nm>Hosting AG</Nm></Cdtr><CdtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></CdtrAcct></RltdPties>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">4.50</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-10-31</Dt></BookgDt>
        <AddtlNtryInf>Kontoführung</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

Deno.test("a statement becomes its account and lines; batches are split, signs follow debit and credit", () => {
  const [result] = parse(statement);
  assertEquals([result.iban, result.currency], ["CH5604835012345678009", "CHF"]);
  assertEquals(result.transactions, [
    {
      id: "TX-1", date: "2026-10-07", amount: 47226, currency: "CHF",
      reference: "210000000003139471430009017", partyName: "Kunde & Co", partyAccount: "CH93 0076 2011 6238 5295 7",
      text: undefined,
    },
    {
      id: "TX-2", date: "2026-10-07", amount: 12774, currency: "CHF",
      reference: undefined, partyName: "Muster AG", partyAccount: undefined, text: "Rechnung 2026-4",
    },
    {
      id: "ENTRY-2:0", date: "2026-10-08", amount: -12000, currency: "CHF",
      reference: "fin-payment-12", partyName: "Hosting AG", partyAccount: "DE89370400440532013000", text: undefined,
    },
    { id: "STMT-2026-10-07:2", date: "2026-10-31", amount: -450, currency: "CHF", text: "Kontoführung" },
  ]);
});

Deno.test("a notification reads alike, prefixed elements and currencies with other decimals too", () => {
  const xml = `<c:Document xmlns:c="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><c:BkToCstmrDbtCdtNtfctn><c:Ntfctn>
    <c:Id>N1</c:Id><c:Acct><c:Id><c:IBAN>KW81CBKU0000000000001234560101</c:IBAN></c:Id><c:Ccy>KWD</c:Ccy></c:Acct>
    <c:Ntry><c:Amt Ccy="KWD">1.5</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:BookgDt><c:Dt>2026-10-07</c:Dt></c:BookgDt>
      <c:AcctSvcrRef>K-1</c:AcctSvcrRef></c:Ntry>
  </c:Ntfctn></c:BkToCstmrDbtCdtNtfctn></c:Document>`;
  const [result] = parse(xml);
  assertEquals(result.iban, "KW81CBKU0000000000001234560101");
  assertEquals(result.transactions.map((t) => [t.id, t.amount]), [["K-1", 1500]]); // KWD has three decimals
});

Deno.test("anything else is refused", () => {
  assertThrows(() => parse("<Document><Other/></Document>"), Error, "camt.053");
});
