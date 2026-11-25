import random
from collections.abc import Callable

from ocr_playground.synth import fake
from ocr_playground.synth.document import Cell, Document, Row, row

_TH = {
    "titles": ["ใบกำกับภาษี / ใบเสร็จรับเงิน", "ใบกำกับภาษี", "ใบส่งสินค้า / ใบกำกับภาษี", "ใบแจ้งหนี้"],
    "tax_id": "เลขประจำตัวผู้เสียภาษี", "head_office": "สาขา สำนักงานใหญ่", "tel": "โทร",
    "customer": "ลูกค้า", "number": "เลขที่", "date": "วันที่",
    "columns": ("ลำดับ", "รายการ", "จำนวน", "ราคาต่อหน่วย", "จำนวนเงิน"),
    "subtotal": "รวมเงิน", "discount": "ส่วนลด", "vat": "ภาษีมูลค่าเพิ่ม 7%", "total": "จำนวนเงินรวมทั้งสิ้น",
    "signatures": ("ผู้รับเงิน", "ผู้มีอำนาจลงนาม"),
}
_EN = {
    "titles": ["TAX INVOICE / RECEIPT", "TAX INVOICE", "INVOICE"],
    "tax_id": "Tax ID", "head_office": "Head Office", "tel": "Tel.",
    "customer": "Customer", "number": "No.", "date": "Date",
    "columns": ("No.", "Description", "Qty", "Unit Price", "Amount"),
    "subtotal": "Subtotal", "discount": "Discount", "vat": "VAT 7%", "total": "Grand Total",
    "signatures": ("Received by", "Authorized Signature"),
}


def invoice(rng: random.Random, english: bool = False) -> Document:
    words = _EN if english else _TH
    seller_th, seller_en = fake.company(rng)
    buyer_th, _ = fake.company(rng)
    seller_addr, buyer_addr = fake.address(rng), fake.address(rng)
    issued = fake.day(rng)
    number = f"{'INV' if english else 'IV'}{issued.year + (0 if english else 543)}-{rng.randint(1, 9999):05d}"

    rows = [
        row(Cell(seller_en if english else seller_th, 0), size=1.35, bold=True),
        row(Cell(seller_addr.line1_en if english else seller_addr.line1, 0)),
        row(Cell(seller_addr.line2_en if english else seller_addr.line2, 0)),
        row(Cell(f"{words['tax_id']} {fake.invalid_id13(rng)} {words['head_office']}", 0)),
        row(Cell(f"{words['tel']} {fake.phone(rng)}", 0)),
        row(Cell(rng.choice(words["titles"]), 0.5, "center"), size=1.3, bold=True, space_before=0.6),
        row(Cell(f"{words['customer']} {buyer_th}", 0), Cell(f"{words['number']} {number}", 1, "right"), space_before=0.4),
        row(Cell(buyer_addr.line1, 0),
            Cell(f"{words['date']} {fake.english_date(issued) if english else fake.thai_date(issued, rng.choice(['long', 'short', 'numeric']))}", 1, "right")),
        row(Cell(buyer_addr.line2, 0)),
        row(Cell(f"{words['tax_id']} {fake.invalid_id13(rng)}", 0)),
    ]

    no, desc, qty, unit, amount = words["columns"]
    rows.append(row(Cell(no, 0), Cell(desc, 0.08), Cell(qty, 0.62, "right"), Cell(unit, 0.81, "right"),
                    Cell(amount, 1, "right"), bold=True, space_before=0.6, rule_below=True))
    subtotal = 0
    goods = rng.sample(fake.GOODS, rng.randint(2, 8))
    for i, (name_th, name_en, low, high) in enumerate(goods, 1):
        count, each = rng.randint(1, 12), fake.price(rng, low, high)
        subtotal += count * each
        rows.append(row(Cell(str(i), 0), Cell(name_en if english else name_th, 0.08), Cell(str(count), 0.62, "right"),
                        Cell(fake.money(each), 0.81, "right"), Cell(fake.money(count * each), 1, "right"),
                        rule_below=i == len(goods)))

    rows.append(row(Cell(words["subtotal"], 0.55), Cell(fake.money(subtotal), 1, "right"), space_before=0.3))
    if rng.random() < 0.3:
        discount = subtotal * rng.choice([3, 5, 10]) // 100
        subtotal -= discount
        rows.append(row(Cell(words["discount"], 0.55), Cell(fake.money(discount), 1, "right")))
    vat = round(subtotal * 7 / 100)
    rows.append(row(Cell(words["vat"], 0.55), Cell(fake.money(vat), 1, "right")))
    rows.append(row(Cell(words["total"], 0.55), Cell(fake.money(subtotal + vat), 1, "right"), bold=True))
    if not english:
        rows.append(row(Cell(f"({fake.baht_text(subtotal + vat)})", 0), space_before=0.3))
    received, authorized = words["signatures"]
    rows.append(row(Cell(received, 0.17, "center"), Cell(authorized, 0.8, "center"), space_before=2.5))
    return Document("invoice-en" if english else "invoice", rows, width=1240, font_px=rng.choice([26, 28, 30]))


def invoice_en(rng: random.Random) -> Document:
    return invoice(rng, english=True)


def receipt(rng: random.Random) -> Document:
    when = fake.day(rng)
    area = rng.choice(fake.AREAS)
    rows = [
        row(Cell(rng.choice(fake.SHOPS), 0.5, "center"), size=1.25, bold=True),
        row(Cell(f"{area[1]} {area[2]}", 0.5, "center")),
        row(Cell(f"โทร {fake.phone(rng, mobile=True)}", 0.5, "center")),
    ]
    if rng.random() < 0.5:
        rows.append(row(Cell(f"TAX ID {fake.invalid_id13(rng)}", 0.5, "center")))
        rows.append(row(Cell("ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ", 0.5, "center"), space_before=0.4))
    else:
        rows.append(row(Cell("ใบเสร็จรับเงิน", 0.5, "center"), space_before=0.4))
    rows.append(row(Cell(f"{fake.thai_date(when, 'numeric')} {rng.randint(7, 21):02d}:{rng.randint(0, 59):02d}", 0),
                    Cell(f"เลขที่ R{rng.randint(1, 99999):05d}", 1, "right"), rule_below=True))
    total = 0
    for name, low, high in rng.sample(fake.FOOD, rng.randint(2, 7)):
        count, each = rng.choice([1, 1, 1, 2, 3]), rng.randint(low, high) * 100
        total += count * each
        rows.append(row(Cell(f"{count} {name}", 0), Cell(fake.money(count * each), 1, "right")))
    rows[-1] = Row(rows[-1].cells, rule_below=True)
    paid = -(-total // 10000) * 10000 + rng.choice([0, 0, 10000, 50000])
    rows += [
        row(Cell("รวม", 0), Cell(fake.money(total), 1, "right"), bold=True, size=1.15),
        row(Cell("เงินสด", 0), Cell(fake.money(paid), 1, "right")),
        row(Cell("เงินทอน", 0), Cell(fake.money(paid - total), 1, "right")),
        row(Cell("ราคารวมภาษีมูลค่าเพิ่มแล้ว", 0.5, "center"), space_before=0.4),
        row(Cell("ขอบคุณที่ใช้บริการ", 0.5, "center")),
    ]
    return Document("receipt", rows, width=576, margin=36, font_px=rng.choice([22, 24]))


def form(rng: random.Random) -> Document:
    who, addr = fake.person(rng), fake.address(rng)
    product_th, _, _, _ = rng.choice(fake.GOODS)
    email = f"{who.first_en.lower()}.{who.last_en[:3].lower()}{rng.randint(1, 99)}@example.com"
    label_x, value_x = 0, 0.3

    def field(label: str, value: str, **kwargs) -> Row:
        return row(Cell(label, label_x), Cell(value, value_x, underline=True), space_before=0.35, **kwargs)

    rows = [
        row(Cell(rng.choice(["แบบฟอร์มลงทะเบียนรับประกันสินค้า", "ใบสมัครสมาชิก", "แบบคำขอรับบริการ"]), 0.5, "center"),
            size=1.35, bold=True),
        row(Cell(f"วันที่ {fake.thai_date(fake.day(rng))}", 1, "right"), space_before=0.6),
        row(Cell("ข้อมูลผู้ยื่นคำขอ", 0), bold=True, space_before=0.6),
        field("ชื่อ-นามสกุล", who.full),
        field("วันเกิด", fake.thai_date(fake.day(rng, fake.date(1960, 1, 1), fake.date(2004, 12, 31)))),
        field("เลขประจำตัวประชาชน", fake.spaced_id(fake.invalid_id13(rng))),
        field("ที่อยู่", addr.line1),
        field("", addr.line2),
        field("โทรศัพท์มือถือ", fake.phone(rng, mobile=True)),
        field("อีเมล", email),
        row(Cell("รายละเอียดสินค้า", 0), bold=True, space_before=0.9),
        field("ชื่อสินค้า", product_th),
        field("หมายเลขเครื่อง", f"SN{rng.randint(10**9, 10**10 - 1)}"),
        field("วันที่ซื้อ", fake.thai_date(fake.day(rng), "numeric")),
        row(Cell("ข้าพเจ้าขอรับรองว่าข้อมูลข้างต้นเป็นความจริงทุกประการ", 0), space_before=1.2),
        row(Cell("ลงชื่อผู้ยื่นคำขอ", 0.45), space_before=1.5),
        row(Cell(f"({who.full})", 0.7, "center")),
    ]
    return Document("form", rows, width=1240, font_px=rng.choice([26, 28, 30]))


def id_card(rng: random.Random) -> Document:
    """A generic bilingual ID card. Marked SPECIMEN, no emblem, and the ID number fails its checksum."""
    who, addr = fake.person(rng), fake.address(rng)
    born = fake.day(rng, fake.date(1960, 1, 1), fake.date(2004, 12, 31))
    issued = fake.day(rng, fake.date(2020, 1, 1), fake.date(2026, 6, 30))
    expires = issued.replace(year=issued.year + 8)
    rows = [
        row(Cell("บัตรประจำตัวตัวอย่าง SPECIMEN", 0), bold=True, size=1.15),
        row(Cell(f"เลขประจำตัว {fake.spaced_id(fake.invalid_id13(rng))}", 0), bold=True, space_before=0.3),
        row(Cell(f"ชื่อตัวและชื่อสกุล {who.full}", 0), space_before=0.2),
        row(Cell(f"Name {who.title_en} {who.first_en}", 0)),
        row(Cell(f"Last name {who.last_en}", 0)),
        row(Cell(f"เกิดวันที่ {fake.thai_date(born, 'short')}", 0)),
        row(Cell(f"Date of Birth {fake.english_date(born)}", 0)),
        row(Cell(f"ที่อยู่ {addr.line1}", 0), size=0.9, space_before=0.2),
        row(Cell(addr.line2, 0), size=0.9),
        row(Cell(f"วันออกบัตร {fake.thai_date(issued, 'short')}", 0),
            Cell(f"วันบัตรหมดอายุ {fake.thai_date(expires, 'short')}", 1, "right"), size=0.85, space_before=0.2),
    ]
    tint = rng.choice([(236, 244, 250), (244, 240, 230), (238, 246, 238)])
    return Document("id-card", rows, width=1012, height=638, margin=48, font_px=22, paper=tint,
                    boxes=[(0.015, 0.02, 0.985, 0.98), (0.75, 0.14, 0.95, 0.52)])


TEMPLATES: dict[str, Callable[[random.Random], Document]] = {
    "invoice": invoice,
    "invoice-en": invoice_en,
    "receipt": receipt,
    "form": form,
    "id-card": id_card,
}
