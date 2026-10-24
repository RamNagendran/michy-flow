"""Reading bills without AI: PDF text, on-device OCR, the GST e-invoice QR code, then rules.

files    – what kind of file it really is, and safe size limits
text     – the lines of text on the bill (PDF text layer, or OCR as a fallback)
ocr      – RapidOCR, run locally; boxes regrouped into reading-order lines
qr       – the signed e-invoice QR code, when the bill has one
numbers  – Indian number formats and GSTIN checks
fields   – picking supplier, invoice number, date, quantity, rate and totals out of the lines
"""
