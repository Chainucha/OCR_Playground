"""Fictional Thai document data. Every value is made up; ID numbers are built to fail their checksum."""

import random
from dataclasses import dataclass
from datetime import date, timedelta

MONTHS_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
             "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
MONTHS_TH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                   "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
MONTHS_EN_SHORT = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."]

FIRST_NAMES = [
    ("สมชาย", "Somchai", "m"), ("วิชัย", "Wichai", "m"), ("ณัฐพล", "Nattaphon", "m"), ("ธนากร", "Thanakorn", "m"),
    ("อนุชา", "Anucha", "m"), ("ประเสริฐ", "Prasert", "m"), ("ศุภชัย", "Supachai", "m"), ("กิตติพงษ์", "Kittipong", "m"),
    ("เกียรติศักดิ์", "Kiattisak", "m"), ("ภานุวัฒน์", "Panuwat", "m"), ("สมหญิง", "Somying", "f"), ("กมลวรรณ", "Kamonwan", "f"),
    ("ปิยะนุช", "Piyanuch", "f"), ("สุภาพร", "Supaporn", "f"), ("จิราพร", "Jiraporn", "f"), ("วราภรณ์", "Waraporn", "f"),
    ("พิมพ์ชนก", "Pimchanok", "f"), ("อรุณี", "Arunee", "f"), ("ฐิติมา", "Thitima", "f"), ("ชลธิชา", "Chonthicha", "f"),
]
LAST_NAMES = [
    ("ใจดี", "Jaidee"), ("ศรีสุข", "Srisuk"), ("วงศ์สวัสดิ์", "Wongsawat"), ("แก้วมณี", "Kaewmanee"), ("ทองคำ", "Thongkham"),
    ("บุญมา", "Boonma"), ("รัตนพันธ์", "Rattanaphan"), ("สุขเจริญ", "Sukcharoen"), ("พงษ์ไพบูลย์", "Pongpaiboon"),
    ("จันทร์เพ็ญ", "Chanpen"), ("เพชรรัตน์", "Phetcharat"), ("อินทร์แก้ว", "Inkaew"), ("ธนสาร", "Thanasan"), ("มหาวงศ์", "Mahawong"),
]
COMPANY_HEAD = [("สยาม", "Siam"), ("รุ่งเรือง", "Rungruang"), ("เจริญ", "Charoen"), ("ศรีทอง", "Srithong"), ("บูรพา", "Burapha"),
                ("อุดม", "Udom"), ("มั่นคง", "Mankong"), ("ก้าวหน้า", "Kaona"), ("ทวีทรัพย์", "Taweesap"), ("ธารา", "Thara")]
COMPANY_TAIL = [("ซัพพลาย", "Supply"), ("เทรดดิ้ง", "Trading"), ("เทคโนโลยี", "Technology"), ("การค้า", "Commercial"),
                ("อินเตอร์", "Inter"), ("ดิจิทัล", "Digital"), ("ออฟฟิศ", "Office"), ("วิศวกรรม", "Engineering"), ("ฟู้ดส์", "Foods")]
SHOPS = ["ร้านครัวคุณแม่", "ร้านกาแฟบ้านสวน", "ร้านข้าวมันไก่เจ๊หมวย", "ร้านรุ่งเรืองพาณิชย์", "ร้านก๋วยเตี๋ยวเรือป้าแดง",
         "ร้านอาหารริมน้ำ", "ร้านเบเกอรี่ยิ้มหวาน", "ร้านส้มตำนัวนัว", "ร้านโชห่วยลุงเปี๊ยก"]
ROADS = [("สุขุมวิท", "Sukhumvit"), ("พหลโยธิน", "Phahonyothin"), ("รัชดาภิเษก", "Ratchadaphisek"), ("เพชรบุรี", "Phetchaburi"),
         ("ลาดพร้าว", "Lat Phrao"), ("นิมมานเหมินท์", "Nimmanhaemin"), ("มิตรภาพ", "Mittraphap"), ("เพชรเกษม", "Phet Kasem")]
AREAS = [  # (sub-district, district, province, postcode, English)
    ("สีลม", "บางรัก", "กรุงเทพมหานคร", "10500", "Si Lom, Bang Rak, Bangkok"),
    ("ลาดยาว", "จตุจักร", "กรุงเทพมหานคร", "10900", "Lat Yao, Chatuchak, Bangkok"),
    ("คลองตัน", "คลองเตย", "กรุงเทพมหานคร", "10110", "Khlong Tan, Khlong Toei, Bangkok"),
    ("บางนา", "บางนา", "กรุงเทพมหานคร", "10260", "Bang Na, Bang Na, Bangkok"),
    ("ช้างคลาน", "เมืองเชียงใหม่", "เชียงใหม่", "50100", "Chang Khlan, Mueang Chiang Mai, Chiang Mai"),
    ("ในเมือง", "เมืองขอนแก่น", "ขอนแก่น", "40000", "Nai Mueang, Mueang Khon Kaen, Khon Kaen"),
    ("หาดใหญ่", "หาดใหญ่", "สงขลา", "90110", "Hat Yai, Hat Yai, Songkhla"),
    ("บางปลา", "บางพลี", "สมุทรปราการ", "10540", "Bang Pla, Bang Phli, Samut Prakan"),
    ("ตลาดใหญ่", "เมืองภูเก็ต", "ภูเก็ต", "83000", "Talat Yai, Mueang Phuket, Phuket"),
]
GOODS = [  # (Thai, English, min baht, max baht)
    ("กระดาษ A4 80 แกรม", "A4 paper 80 gsm", 95, 160), ("หมึกพิมพ์เลเซอร์", "Laser toner", 890, 3200),
    ("แฟ้มเอกสาร", "Document folder", 25, 90), ("ปากกาลูกลื่น", "Ballpoint pen", 8, 25),
    ("เมาส์ไร้สาย", "Wireless mouse", 290, 990), ("คีย์บอร์ด", "Keyboard", 390, 1890),
    ("สาย HDMI 2 เมตร", "HDMI cable 2 m", 150, 450), ("ฮาร์ดดิสก์ภายนอก 1 TB", "External HDD 1 TB", 1590, 2490),
    ("จอภาพ 24 นิ้ว", "24-inch monitor", 3290, 6990), ("ค่าบริการติดตั้ง", "Installation service", 500, 3000),
    ("แบตเตอรี่สำรอง", "Power bank", 390, 1290), ("เครื่องคิดเลข", "Calculator", 150, 690),
    ("กระดาษโน้ต", "Sticky notes", 20, 65), ("ลวดเย็บกระดาษ", "Staples", 12, 40), ("ค่าขนส่ง", "Delivery fee", 50, 300),
]
FOOD = [("ข้าวผัดกุ้ง", 50, 80), ("กะเพราหมูสับ ไข่ดาว", 50, 70), ("ต้มยำกุ้ง", 120, 250), ("ชาเย็น", 25, 45),
        ("กาแฟเย็น", 35, 65), ("น้ำดื่ม", 10, 15), ("ส้มตำไทย", 40, 70), ("ไก่ทอด", 45, 90), ("ผัดไทยกุ้งสด", 60, 120),
        ("ข้าวเหนียวมะม่วง", 60, 120), ("โจ๊กหมู", 35, 55), ("บะหมี่เกี๊ยว", 45, 70)]


@dataclass(frozen=True)
class Person:
    title: str
    first: str
    last: str
    title_en: str
    first_en: str
    last_en: str

    @property
    def full(self) -> str:
        return f"{self.title}{self.first} {self.last}"


@dataclass(frozen=True)
class Address:
    line1: str
    line2: str
    line1_en: str
    line2_en: str


def person(rng: random.Random) -> Person:
    first, first_en, sex = rng.choice(FIRST_NAMES)
    last, last_en = rng.choice(LAST_NAMES)
    if sex == "m":
        return Person("นาย", first, last, "Mr.", first_en, last_en)
    title, title_en = rng.choice([("นาง", "Mrs."), ("นางสาว", "Miss")])
    return Person(title, first, last, title_en, first_en, last_en)


def company(rng: random.Random) -> tuple[str, str]:
    (head, head_en), (tail, tail_en) = rng.choice(COMPANY_HEAD), rng.choice(COMPANY_TAIL)
    form, form_en = rng.choice([("บริษัท {} จำกัด", "{} Co., Ltd."), ("บริษัท {} จำกัด (มหาชน)", "{} PCL"),
                                ("ห้างหุ้นส่วนจำกัด {}", "{} Ltd. Part.")])
    return form.format(head + tail), form_en.format(f"{head_en} {tail_en}")


def address(rng: random.Random) -> Address:
    sub, district, province, postcode, area_en = rng.choice(AREAS)
    road, road_en = rng.choice(ROADS)
    house = f"{rng.randint(1, 999)}/{rng.randint(1, 99)}" if rng.random() < 0.6 else str(rng.randint(1, 999))
    if province == "กรุงเทพมหานคร":
        line2 = f"แขวง{sub} เขต{district} {province} {postcode}"
    else:
        line2 = f"ตำบล{sub} อำเภอ{district} จังหวัด{province} {postcode}"
    return Address(f"{house} ถนน{road}", line2, f"{house} {road_en} Road", f"{area_en} {postcode}")


def phone(rng: random.Random, mobile: bool = False) -> str:
    if mobile:
        return f"0{rng.choice('689')}{rng.randint(0, 9)}-{rng.randint(0, 999):03d}-{rng.randint(0, 9999):04d}"
    return f"02-{rng.randint(100, 999)}-{rng.randint(0, 9999):04d}"


def invalid_id13(rng: random.Random) -> str:
    """13 digits shaped like a Thai citizen or tax ID, with a wrong check digit so it can't be real."""
    digits = [rng.randint(1, 8)] + [rng.randint(0, 9) for _ in range(11)]
    check = (11 - sum(d * (13 - i) for i, d in enumerate(digits)) % 11) % 10
    return "".join(map(str, digits)) + str((check + rng.randint(1, 9)) % 10)


def id13_is_valid(number: str) -> bool:
    digits = [int(c) for c in number if c.isdigit()]
    return len(digits) == 13 and (11 - sum(d * (13 - i) for i, d in enumerate(digits[:12])) % 11) % 10 == digits[12]


def spaced_id(number: str) -> str:
    return f"{number[0]} {number[1:5]} {number[5:10]} {number[10:12]} {number[12]}"


def day(rng: random.Random, start: date = date(2024, 1, 1), end: date = date(2026, 12, 31)) -> date:
    return start + timedelta(days=rng.randint(0, (end - start).days))


def thai_date(d: date, style: str = "long") -> str:
    year = d.year + 543
    if style == "long":
        return f"{d.day} {MONTHS_TH[d.month - 1]} {year}"
    if style == "short":
        return f"{d.day} {MONTHS_TH_SHORT[d.month - 1]} {year}"
    return f"{d.day:02d}/{d.month:02d}/{year}"


def english_date(d: date) -> str:
    return f"{d.day} {MONTHS_EN_SHORT[d.month - 1]} {d.year}"


def money(satang: int) -> str:
    return f"{satang // 100:,}.{satang % 100:02d}"


def price(rng: random.Random, low: int, high: int) -> int:
    """A price in satang."""
    return rng.randint(low, high) * 100 + rng.choice([0, 0, 0, 25, 50, 75])


_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]


def _read_number(n: int, after_higher: bool = False) -> str:
    if n >= 1_000_000:
        millions, rest = divmod(n, 1_000_000)
        return _read_number(millions) + "ล้าน" + (_read_number(rest, after_higher=True) if rest else "")
    words = []
    digits = str(n)
    for i, ch in enumerate(digits):
        d, place = int(ch), len(digits) - i - 1
        if d == 0:
            continue
        if place == 1 and d == 1:
            words.append("สิบ")
        elif place == 1 and d == 2:
            words.append("ยี่สิบ")
        elif place == 0 and d == 1 and (n > 9 or after_higher):
            words.append("เอ็ด")
        else:
            words.append(_DIGITS[d] + _PLACES[place])
    return "".join(words)


def baht_text(satang: int) -> str:
    """Amount in Thai words as printed on invoices, e.g. 120910 -> หนึ่งพันสองร้อยเก้าบาทสิบสตางค์."""
    baht, st = divmod(satang, 100)
    if not baht and not st:
        return "ศูนย์บาทถ้วน"
    text = _read_number(baht) + "บาท" if baht else ""
    return text + (_read_number(st) + "สตางค์" if st else "ถ้วน")
