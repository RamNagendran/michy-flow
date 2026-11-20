"""HTML mails in the Michy look. Table layout and inline styles, because mail apps (Gmail,
Outlook) ignore most modern CSS. Each builder returns (subject, html, plain text)."""

from html import escape

from app.core.clock import today
from app.core.config import settings

_BRAND = "#D82E54"
_INK = "#17171A"
_TEXT = "#1F2329"
_MUTED = "#5B6270"
_FAINT = "#8A919E"
_BORDER = "#E8EAEE"
_BG = "#F5F6F8"
_SOFT = "#FDEEF2"
_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def _layout(preheader: str, body: str) -> str:
    """The shared frame: dark header with the wordmark, white card, footer."""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Michy Rubbers</title>
</head>
<body style="margin:0;padding:0;background:{_BG};font-family:{_FONT};color:{_TEXT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;
border:1px solid {_BORDER};">
<tr><td style="background:{_INK};padding:26px 36px;">
<div style="font-size:16px;font-weight:800;letter-spacing:0.14em;color:#ffffff;">
<span style="color:{_BRAND};">MICHY</span> RUBBERS</div>
<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.55);margin-top:4px;">
Operations platform</div>
</td></tr>
<tr><td style="height:4px;background:{_BRAND};line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:36px 36px 32px;">
{body}
</td></tr>
<tr><td style="padding:20px 36px 28px;border-top:1px solid {_BORDER};">
<p style="margin:0;font-size:12px;line-height:1.6;color:{_FAINT};">
This is an automatic mail from Michy Rubbers. Please do not reply to it.<br>
&copy; {today().year} Michy Rubbers &middot; Create a better future by minimizing waste</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _greeting(name: str) -> str:
    first = name.strip().split(" ")[0] if name.strip() else ""
    return f"Hi {first}," if first else "Hi,"


def _code_mail(heading: str, intro: str, code: str, minutes: int, footnote: str) -> str:
    """Body of a code mail: heading, intro (already HTML-safe), the code in boxes, a footnote."""
    digits = "".join(
        f'<td style="padding:0 4px;"><div style="width:44px;height:54px;line-height:54px;'
        f"text-align:center;font-size:28px;font-weight:800;color:{_INK};background:#ffffff;"
        f'border:1.5px solid {_BORDER};border-radius:10px;">{d}</div></td>'
        for d in code
    )
    return f"""
<p style="margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:0.12em;color:{_BRAND};">
VERIFY YOUR EMAIL</p>
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;font-weight:800;color:{_INK};">
{heading}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:{_TEXT};">{intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="background:{_SOFT};border-radius:12px;">
<tr><td align="center" style="padding:26px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>{digits}</tr></table>
<p style="margin:16px 0 0;font-size:13px;color:{_MUTED};">
This code works for <strong style="color:{_TEXT};">{minutes} minutes</strong>.</p>
</td></tr>
</table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:{_MUTED};">{footnote}</p>"""


def signup_otp(name: str, code: str, minutes: int) -> tuple[str, str, str]:
    subject = f"{code} is your Michy Rubbers sign-up code"
    body = _code_mail(
        "Your sign-up code",
        f"{escape(_greeting(name))}<br>"
        "Enter this code on the sign-up page to create your Michy Rubbers account.",
        code,
        minutes,
        "Do not share this code with anyone. Michy Rubbers staff will never ask for it.<br>"
        "If you did not try to sign up, you can ignore this mail.",
    )
    text = (
        f"{_greeting(name)}\n\n"
        f"Your Michy Rubbers sign-up code is: {code}\n\n"
        f"It works for {minutes} minutes. Do not share it with anyone.\n"
        "If you did not try to sign up, you can ignore this mail.\n\n"
        "This is an automatic mail. Please do not reply."
    )
    return subject, _layout(f"Your sign-up code is {code}", body), text


def member_otp(
    name: str, code: str, minutes: int, added_by: str, organisation: str
) -> tuple[str, str, str]:
    """The Super Admin is adding this person; they read the code back to the Super Admin."""
    subject = f"{code} is your Michy Rubbers verification code"
    body = _code_mail(
        "Your verification code",
        f"{escape(_greeting(name))}<br>"
        f"<strong>{escape(added_by)}</strong> is adding you to "
        f"<strong>{escape(organisation)}</strong> on Michy Rubbers. "
        f"Tell this code to {escape(added_by)} to finish creating your account.",
        code,
        minutes,
        f"Share this code only with {escape(added_by)}.<br>"
        "If you do not know about this, you can ignore this mail. No account will be made.",
    )
    text = (
        f"{_greeting(name)}\n\n"
        f"{added_by} is adding you to {organisation} on Michy Rubbers.\n"
        f"Tell this code to {added_by} to finish creating your account: {code}\n\n"
        f"It works for {minutes} minutes.\n"
        "If you do not know about this, you can ignore this mail. No account will be made.\n\n"
        "This is an automatic mail. Please do not reply."
    )
    return subject, _layout(f"Your verification code is {code}", body), text


def _login_url() -> str:
    return settings.FRONTEND_BASE_URL.rstrip("/") + "/login"


def _button(url: str) -> str:
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
<tr><td style="border-radius:10px;background:{_BRAND};">
<a href="{escape(url)}" target="_blank"
 style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;
text-decoration:none;border-radius:10px;">Open Michy Rubbers</a>
</td></tr>
</table>"""


def welcome(name: str, organisation: str) -> tuple[str, str, str]:
    subject = "Welcome to Michy Rubbers"
    login_url = _login_url()
    steps = [
        ("Add your companies", "Each company gets its own purchases, production and sales."),
        ("Add your team", "Give managers and operators their own login and role."),
        ("Start entries", "Record purchases, production runs and sales every day."),
    ]
    rows = "".join(
        f"""<tr>
<td valign="top" style="padding:0 14px 16px 0;width:30px;">
<div style="width:28px;height:28px;line-height:28px;border-radius:14px;background:{_SOFT};
color:{_BRAND};font-size:13px;font-weight:800;text-align:center;">{i}</div></td>
<td valign="top" style="padding:0 0 16px;">
<div style="font-size:15px;font-weight:700;color:{_INK};">{title}</div>
<div style="font-size:13px;line-height:1.5;color:{_MUTED};margin-top:2px;">{detail}</div>
</td></tr>"""
        for i, (title, detail) in enumerate(steps, start=1)
    )
    body = f"""
<p style="margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:0.12em;color:{_BRAND};">
ACCOUNT READY</p>
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;font-weight:800;color:{_INK};">
Welcome to Michy Rubbers</h1>
<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:{_TEXT};">
{escape(_greeting(name))}<br>
Your organisation <strong>{escape(organisation)}</strong> is ready. You are its Super Admin,
so you can add companies, people and settings.</p>
<p style="margin:24px 0 14px;font-size:13px;font-weight:800;letter-spacing:0.08em;color:{_FAINT};">
NEXT STEPS</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>
{_button(login_url)}
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:{_MUTED};">
Sign in with <strong style="color:{_TEXT};">this email address</strong> and the password you
just set.</p>"""
    text = (
        f"{_greeting(name)}\n\n"
        f"Your organisation {organisation} is ready on Michy Rubbers. You are its Super Admin.\n\n"
        "Next steps:\n"
        + "".join(f"{i}. {t}: {d}\n" for i, (t, d) in enumerate(steps, start=1))
        + f"\nSign in here: {login_url}\n\n"
        "This is an automatic mail. Please do not reply."
    )
    return subject, _layout(f"{organisation} is ready. Here is how to start.", body), text


def welcome_member(
    name: str, organisation: str, added_by: str, temporary_password: str
) -> tuple[str, str, str]:
    """For a person the Super Admin added. The temporary password must be changed at first
    sign-in, so it is safe to send once to the address they just verified."""
    subject = f"Welcome to {organisation} on Michy Rubbers"
    login_url = _login_url()
    body = f"""
<p style="margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:0.12em;color:{_BRAND};">
ACCOUNT READY</p>
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;font-weight:800;color:{_INK};">
Welcome to Michy Rubbers</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:{_TEXT};">
{escape(_greeting(name))}<br>
<strong>{escape(added_by)}</strong> has made your account in
<strong>{escape(organisation)}</strong>. Use these details to sign in.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="background:{_BG};border:1px solid {_BORDER};border-radius:12px;">
<tr><td style="padding:18px 22px 6px;">
<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;color:{_FAINT};">EMAIL</div>
<div style="font-size:15px;font-weight:700;color:{_INK};margin-top:4px;">This email address</div>
</td></tr>
<tr><td style="padding:12px 22px 18px;">
<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;color:{_FAINT};">
TEMPORARY PASSWORD</div>
<div style="font-size:18px;font-weight:800;color:{_INK};margin-top:4px;letter-spacing:0.06em;
font-family:Menlo,Consolas,monospace;">{escape(temporary_password)}</div>
</td></tr>
</table>
<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
{_button(login_url)}
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:{_MUTED};">
You will be asked to set your own password when you first sign in.<br>
Do not share this password with anyone.</p>"""
    text = (
        f"{_greeting(name)}\n\n"
        f"{added_by} has made your account in {organisation} on Michy Rubbers.\n\n"
        "Email: this email address\n"
        f"Temporary password: {temporary_password}\n\n"
        f"Sign in here: {login_url}\n"
        "You will be asked to set your own password when you first sign in.\n\n"
        "This is an automatic mail. Please do not reply."
    )
    return subject, _layout(f"Your {organisation} account is ready.", body), text
