"""Rule-based CV lint. Free: never calls the AI."""

from __future__ import annotations

import re

from .models import CV, Finding, Review, Scores

WEAK_OPENERS = {
    "responsible", "worked", "helped", "assisted", "participated", "part", "learned", "gained",
    "involved", "tasked", "joined", "duties", "handled", "contributed", "utilized", "used",
}  # fmt: skip
IRREGULAR_VERBS = {
    "led", "built", "ran", "drove", "won", "taught", "wrote", "grew", "cut", "made", "oversaw",
    "set", "took", "brought", "began", "held", "kept", "met", "sold", "spoke", "rebuilt", "shipped",
    "spearheaded", "undertook", "overcame", "redid", "withstood", "sought", "thought", "lent",
}  # fmt: skip
# Bullets in these sections are descriptions, not achievements.
_DESCRIPTIVE = {"skills", "languages", "summary", "projects", "publications", "awards"}

_METRIC = re.compile(r"\d+(?:[.,]\d+)?\s?(?:%|x\b|k\b|m\b|\+)|[$€£¥]|\brp\.?\s?\d|\b(?!(?:19|20)\d{2}\b)\d+\b", re.I)
_PRONOUN = re.compile(r"\b(?:I|my|me|we|our)\b")


def _first_word(text: str) -> str:
    m = re.match(r"[A-Za-z][A-Za-z'’-]*", text)
    return m.group(0).lower() if m else ""


def review_cv(cv: CV) -> Review:
    findings: list[Finding] = []
    total = with_action = with_metric = too_long = 0
    with_period: list[str] = []
    without_period: list[str] = []

    def add(target: str | None, severity: str, code: str, message: str) -> None:
        findings.append(Finding(target_id=target, severity=severity, code=code, message=message))

    if not cv.header.name.strip():
        add("header", "error", "no_name", "The CV has no name.")
    if not any(c.kind == "email" for c in cv.header.contacts):
        add("header", "warn", "no_email", "No email address was found in the contact line.")

    visible = [s for s in cv.sections if s.visible]
    if not any(s.type == "summary" for s in visible):
        add(None, "info", "no_summary", "Consider adding a 2-3 line professional summary.")
    if not any(s.type == "experience" for s in visible):
        add(None, "warn", "no_experience", "No work experience section was found.")

    for sec in visible:
        achievement = sec.type not in _DESCRIPTIVE
        if sec.type == "summary" and len(sec.text.split()) > 80:
            add(sec.id, "warn", "summary_long", "The summary is over 80 words; aim for 40-60.")
        for item in sec.items:
            if achievement and item.title and not item.date:
                add(item.id, "info", "no_date", f'"{item.title}" has no date.')
            if sec.type == "experience" and not item.bullets:
                add(item.id, "warn", "no_bullets", f'"{item.title}" has no bullet points describing what you achieved.')
        groups = [sec.bullets] + [i.bullets for i in sec.items]
        for bullets in groups:
            for b in bullets:
                text = b.text.strip()
                if not text:
                    continue
                (with_period if text.endswith(".") else without_period).append(b.id)
                words = len(text.split())
                if words > 32:
                    too_long += achievement
                    add(b.id, "warn", "too_long", f"{words} words. Split it or cut it to under 30.")
                if _PRONOUN.search(text):
                    add(b.id, "warn", "first_person", "Avoid first-person pronouns; start with the action verb.")
                if not achievement:
                    continue
                total += 1
                first = _first_word(text)
                if first in WEAK_OPENERS:
                    add(b.id, "warn", "weak_opener", f'"{first.capitalize()}" is a weak opener; lead with what you did (Built, Led, Reduced...).')
                elif first.endswith("ed") or first in IRREGULAR_VERBS:
                    with_action += 1
                else:
                    add(b.id, "info", "no_action_verb", "Start with a past-tense action verb to state the Action clearly.")
                if _METRIC.search(text):
                    with_metric += 1
                else:
                    add(b.id, "info", "no_metric", "No measurable Result. Add a number, percentage, scale or outcome.")
                if words < 5:
                    add(b.id, "info", "too_short", "Too short to show situation, action and result.")

    if with_period and without_period and cv.style.bullet_period == "keep":
        minority = min(with_period, without_period, key=len)
        add(
            None,
            "warn",
            "inconsistent_period",
            f"{len(minority)} bullet(s) end differently from the rest (trailing period). "
            'Set style.bullet_period to "add" or "remove" to make them consistent.',
        )

    def pct(n: int) -> int:
        return round(100 * n / total) if total else 0

    impact = pct(with_metric)
    star = round((pct(with_action) + impact) / 2)
    concision = max(0, 100 - round(100 * too_long / total)) if total else 0
    penalty = 10 * sum(1 for f in findings if f.severity == "error") + 3 * sum(
        1 for f in findings if f.severity == "warn" and f.target_id in (None, "header")
    )
    overall = max(0, round(0.45 * star + 0.25 * concision + 0.3 * impact) - penalty) if total else 0
    summary = (
        f"{with_metric} of {total} achievement bullets show a measurable result and "
        f"{with_action} start with a strong action verb."
        if total
        else "No achievement bullets were found to review."
    )
    return Review(
        scores=Scores(star=star, concision=concision, impact=impact, overall=overall),
        summary=summary,
        findings=findings,
    )
