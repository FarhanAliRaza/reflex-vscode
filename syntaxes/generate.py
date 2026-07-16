"""Generate the reflex injection grammars from regions/regions.json.

Adapted from the generator in samwillis/python-inline-source (MIT): same
"config table -> injection grammar" idea, but triggers key on Reflex APIs and
comment tags instead of type annotations.

Emits two grammars:
- reflex.injection.tmLanguage.json — injected into source.python; carves
  embedded CSS/JS/JSX/HTML regions out of Reflex string contexts.
- reflex-fstring.injection.tmLanguage.json — injected into the *.fstring
  embedded scopes produced by the first grammar; makes f-string {placeholders}
  render as Python at every nesting depth of the embedded language (a rule
  inside the region's own patterns only applies at the top nesting level,
  so this must be an injection).

Usage: python3 syntaxes/generate.py [--no-method-body]
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUOTES = ['"""', "'''", '"', "'"]
PLAIN_PREFIX = r"(?:[bBuU][rR]?|[rR][bBuU]?)?"
F_PREFIX = r"(?:[fF][rR]?|[rR][fF])"

PUNCT_BEGIN = "punctuation.definition.string.begin.python"
PUNCT_END = "punctuation.definition.string.end.python"
STORAGE = "storage.type.string.python"
COMMENT = "comment.line.number-sign.python"
PY = {"include": "source.python"}

# Scopes that may receive a ".fstring" suffix; drives the second grammar's
# injection selector and must stay in sync with package.json embeddedLanguages.
FSTRING_SCOPES = [
    "meta.embedded.block.javascript",
    "meta.embedded.block.javascriptreact",
    "meta.embedded.block.typescript",
    "meta.embedded.block.css",
    "meta.embedded.block.html",
    "meta.embedded.inline.css",
    "meta.embedded.inline.tailwind-classes",
]


def content_name(base: str, is_f: bool) -> str:
    """Scope for an embedded region, marking f-strings for the guts injection.

    Args:
        base: The context's tmContentName.
        is_f: Whether the string is an f-string.

    Returns:
        The scope, suffixed with ".fstring" for f-strings.
    """
    return f"{base}.fstring" if is_f else base


def string_end(quote: str) -> str:
    """End pattern for a string region.

    Args:
        quote: The quote token that opened the string.

    Returns:
        A regex ending at the closing quote (or, for single-line strings, at
        an unescaped end of line so a broken string cannot poison the file).
    """
    q = re.escape(quote)
    if len(quote) == 3:
        return f"({q})"
    return f"({q})|(?<!\\\\)$"


def content_patterns(include: str | None) -> list[dict]:
    """Patterns for the inside of an embedded string region.

    F-string placeholders are handled by the separate fstring injection
    grammar, not here — an in-region rule cannot reach into the embedded
    language's nested sub-rules.

    Args:
        include: TextMate scope to include for the embedded language.

    Returns:
        Ordered pattern list: python escapes, then the language include.
    """
    patterns: list[dict] = [{"include": "#string-escape"}]
    if include:
        patterns.append({"include": include})
    return patterns


def string_rule(
    begin_prefix: str,
    quote: str,
    is_f: bool,
    ctx_content_name: str | None,
    include: str | None,
    prefix_captures: dict | None = None,
) -> dict:
    """Build one string-region rule.

    Args:
        begin_prefix: Regex matched (and captured as group 1) before the
            string prefix/quote; may be empty.
        quote: Quote token.
        is_f: Whether to build the f-string variant.
        ctx_content_name: Base tmContentName scope (None for no scoping).
        include: Embedded language include scope.
        prefix_captures: Captures spec for group 1; defaults to re-tokenizing
            it as Python.

    Returns:
        The TextMate rule.
    """
    str_prefix = F_PREFIX if is_f else PLAIN_PREFIX
    rule = {
        "begin": f"({begin_prefix})({str_prefix})({re.escape(quote)})",
        "beginCaptures": {
            "1": prefix_captures or {"patterns": [PY]},
            "2": {"name": STORAGE},
            "3": {"name": PUNCT_BEGIN},
        },
        "end": string_end(quote),
        "endCaptures": {"1": {"name": PUNCT_END}},
        "patterns": content_patterns(include),
    }
    if ctx_content_name:
        rule["contentName"] = content_name(ctx_content_name, is_f)
    return rule


def string_arg_rules(ctx: dict) -> list[dict]:
    """Rules for a trigger followed by a string literal on the same line.

    Args:
        ctx: A regions.json context of kind "string-arg".

    Returns:
        One rule per quote flavor x (plain, f-string).
    """
    return [
        string_rule(
            f"{ctx['trigger']}\\s*",
            quote,
            is_f,
            ctx["tmContentName"],
            ctx.get("tmInclude"),
        )
        for quote in QUOTES
        for is_f in (False, True)
    ]


def css_kwarg_rules(props: list[str]) -> list[dict]:
    """Rules for CSS-property kwargs like background_image="linear-gradient(...)".

    Args:
        props: snake_case CSS property names.

    Returns:
        Rules embedding source.css#property-values in the kwarg value string.
    """
    alt = "|".join(props)
    rules = []
    for quote in ('"', "'"):
        for is_f in (False, True):
            rule = string_rule(
                f"\\b(?=[a-z][a-z_]*\\s*=\\s*[a-zA-Z]{{0,2}}[\"'])(?:{alt})\\s*=\\s*",
                quote,
                is_f,
                "meta.embedded.inline.css",
                "source.css#property-values",
                prefix_captures={
                    "patterns": [
                        {
                            "match": "[a-z_]+",
                            "name": "support.type.property-name.css",
                        }
                    ]
                },
            )
            rules.append(rule)
    return rules


def style_dict_rules(ctx: dict, pseudo_props: list[str]) -> list[dict]:
    """Rules for style={...} / pseudo-prop dicts / rx.Style({...}).

    Args:
        ctx: The style-dict context from regions.json.
        pseudo_props: Pseudo-selector prop names (_hover, ...).

    Returns:
        Begin/end rules delegating to the shared #style-dict-innards.
    """
    rules = []
    for trigger in ctx["triggers"]:
        trigger = trigger.replace("STYLE_PSEUDO_PROPS", "|".join(pseudo_props))
        trigger = trigger.replace("(?=\\{)", "")
        rules.append(
            {
                "begin": f"({trigger})(\\{{)",
                "beginCaptures": {
                    "1": {"patterns": [PY]},
                    "2": {"name": "punctuation.definition.dict.begin.python"},
                },
                "end": "\\}",
                "endCaptures": {
                    "0": {"name": "punctuation.definition.dict.end.python"}
                },
                "name": "meta.embedded.style-dict.python",
                "patterns": [{"include": "#style-dict-innards"}],
            }
        )
    return rules


def style_dict_innards() -> dict:
    """The shared repository entry tokenizing the inside of a style dict.

    Key and value rules eat leading whitespace so they match from column 0 and
    win the tie against MagicPython's line-anchored docstring-statement rule.

    Returns:
        Repository entry with nested-dict recursion, CSS key and value rules.
    """
    value_rules = [
        string_rule(
            ":\\s*",
            quote,
            is_f,
            "meta.embedded.inline.css",
            "source.css#property-values",
            prefix_captures={"name": "punctuation.separator.dict.python"},
        )
        for quote in ('"', "'")
        for is_f in (False, True)
    ]
    return {
        "patterns": [
            {
                "begin": "\\{",
                "end": "\\}",
                "patterns": [{"include": "#style-dict-innards"}],
            },
            {
                "match": "\\s*([\"'])([^\"'\\n]+)(\\1)(?=\\s*:)",
                "captures": {
                    "1": {"name": PUNCT_BEGIN},
                    "2": {"name": "support.type.property-name.css"},
                    "3": {"name": PUNCT_END},
                },
            },
            *value_rules,
            PY,
        ]
    }


def classname_rules(ctx: dict) -> list[dict]:
    """Rules scoping class_name string values as tailwind-classes.

    Args:
        ctx: The classname context from regions.json.

    Returns:
        String-form and list-form rules.
    """
    rules = [
        string_rule(f"{ctx['trigger']}\\s*", quote, is_f, ctx["tmContentName"], None)
        for quote in QUOTES
        for is_f in (False, True)
    ]
    list_strings = [
        string_rule("\\s*", quote, is_f, ctx["tmContentName"], None)
        for quote in QUOTES
        for is_f in (False, True)
    ]
    rules.append(
        {
            "begin": f"({ctx['trigger']}\\s*)(\\[)",
            "beginCaptures": {
                "1": {"patterns": [PY]},
                "2": {"name": "punctuation.definition.list.begin.python"},
            },
            "end": "\\]",
            "endCaptures": {"0": {"name": "punctuation.definition.list.end.python"}},
            "patterns": [*list_strings, PY],
        }
    )
    return rules


def langs_by_id(tag_languages: dict) -> dict[str, list[str]]:
    """Group tag words by their VS Code languageId.

    Args:
        tag_languages: Mapping of tag word to languageId.

    Returns:
        Mapping of languageId to its tag words.
    """
    by_lang: dict[str, list[str]] = {}
    for tag, lang in tag_languages.items():
        by_lang.setdefault(lang, []).append(tag)
    return by_lang


def tag_inline_rules(tag_languages: dict, lang_meta: dict) -> list[dict]:
    """Rules for first-line tags inside triple-quoted strings: '''#js ...'''.

    Args:
        tag_languages: Mapping of tag word to VS Code languageId.
        lang_meta: Mapping of languageId to (tmContentName, tmInclude).

    Returns:
        One rule per language x triple-quote flavor x (plain, f-string).
    """
    rules = []
    for lang, tags in langs_by_id(tag_languages).items():
        cname, include = lang_meta[lang]
        tag_alt = "|".join(tags)
        for quote in ('"""', "'''"):
            for is_f in (False, True):
                prefix = F_PREFIX if is_f else PLAIN_PREFIX
                rules.append(
                    {
                        "begin": (
                            f"({prefix})({re.escape(quote)})"
                            f"[ \\t]*(#[ \\t]*(?:{tag_alt}))\\b"
                        ),
                        "beginCaptures": {
                            "1": {"name": STORAGE},
                            "2": {"name": PUNCT_BEGIN},
                            "3": {"name": COMMENT},
                        },
                        "end": string_end(quote),
                        "endCaptures": {"1": {"name": PUNCT_END}},
                        "contentName": content_name(cname, is_f),
                        "patterns": content_patterns(include),
                    }
                )
    return rules


def tag_preceding_rules(
    ctx: dict, tag_languages: dict, lang_meta: dict
) -> list[dict]:
    """Rules for a tag comment line preceding a (module-level) string.

    A comment like `# language=js` (or `# js`) on its own line tags the next
    string literal, optionally behind a `NAME = ` / `NAME: T = ` assignment.
    The outer region ends right after that one string closes (lookbehind on a
    quote) or bails at the first non-blank line that does not start a string.

    Args:
        ctx: The tag-preceding context from regions.json.
        tag_languages: Mapping of tag word to VS Code languageId.
        lang_meta: Mapping of languageId to (tmContentName, tmInclude).

    Returns:
        One outer rule per language, each embedding per-quote string rules.
    """
    assign = "(?:[\\w.]+\\s*(?::[^=\\n]+?)?\\s*=\\s*)?"
    rules = []
    for lang, tags in langs_by_id(tag_languages).items():
        cname, include = lang_meta[lang]
        comment = ctx["commentPattern"].replace("TAGS", "|".join(tags))
        inner = [
            string_rule(f"^\\s*{assign}", quote, is_f, cname, include)
            for quote in QUOTES
            for is_f in (False, True)
        ]
        rules.append(
            {
                "begin": f"^\\s*({comment})",
                "beginCaptures": {"1": {"name": COMMENT}},
                "end": (
                    "(?<=[\"'])"
                    f"|^(?=\\s*\\S)(?!\\s*{assign}[bBuUrRfF]{{0,2}}[\"'])"
                ),
                "patterns": inner,
            }
        )
    return rules


def method_body_rules(ctx: dict) -> list[dict]:
    """Experimental: mark the body of known JS-returning methods with a scope.

    Uses the def line's indentation (backreference) to end the region at the
    first non-blank line that is not indented deeper. The actual JSX string
    embedding is done by the companion method-body injection grammar keyed on
    this scope — a rule here could not reach strings nested inside
    MagicPython's own bracket regions. Known caveats: nested defs and
    docstrings inside these methods are mis-scoped as JSX.

    Args:
        ctx: The method-body context from regions.json.

    Returns:
        A single begin/end rule marking the method body.
    """
    methods = "|".join(ctx["methods"])
    return [
        {
            "begin": f"^(\\s*)(def)\\s+({methods})\\b",
            "beginCaptures": {
                "2": {"name": "storage.type.function.python"},
                "3": {"name": "entity.name.function.python"},
            },
            "end": "^(?=\\s*\\S)(?!\\1\\s+\\S)",
            "name": "meta.function.reflex-custom-code.python",
            "patterns": [PY],
        }
    ]


def method_body_strings_grammar(ctx: dict) -> dict:
    """The third injection grammar: JSX strings inside marked method bodies.

    Returns:
        Grammar injected (left priority) into meta.function.reflex-custom-code
        at any nesting depth, embedding triple-quoted strings as JSX.

    Args:
        ctx: The method-body context from regions.json.
    """
    rules = [
        string_rule("\\s*", quote, is_f, ctx["tmContentName"], ctx["tmInclude"])
        for quote in QUOTES
        for is_f in (False, True)
    ]
    return {
        "$comment": "GENERATED by syntaxes/generate.py — do not edit by hand.",
        "scopeName": "reflex-methodbody.injection",
        "injectionSelector": (
            "L:meta.function.reflex-custom-code.python -string -comment"
            " -meta.embedded"
        ),
        "patterns": rules,
    }


def js_template_grammar(lang_meta: dict) -> dict:
    """The fourth injection grammar: tagged template literals in embedded JS.

    A `/* css */` (or `/* html */`) comment before a backtick template inside
    an embedded JS/JSX/TS region embeds that template's content — the
    convention of mjbvz/vscode-comment-tagged-templates, injected into our
    embedded scopes (an in-region rule could not reach templates nested
    inside the JS grammar's own sub-rules).

    Args:
        lang_meta: Mapping of languageId to (tmContentName, tmInclude).

    Returns:
        The injection grammar.
    """
    rules = []
    for tag in ("css", "html"):
        cname, include = lang_meta[tag]
        rules.append(
            {
                "begin": f"(/\\*\\s*{tag}\\s*\\*/)\\s*(`)",
                "beginCaptures": {
                    "1": {"name": "comment.block.js"},
                    "2": {
                        "name": "punctuation.definition.string.template.begin.js"
                    },
                },
                "end": "(`)",
                "endCaptures": {
                    "1": {"name": "punctuation.definition.string.template.end.js"}
                },
                "contentName": cname,
                "patterns": [
                    {"match": "\\\\.", "name": "constant.character.escape.js"},
                    {
                        "begin": "\\$\\{",
                        "beginCaptures": {
                            "0": {
                                "name": "punctuation.definition.template-expression.begin.js"
                            }
                        },
                        "end": "\\}",
                        "endCaptures": {
                            "0": {
                                "name": "punctuation.definition.template-expression.end.js"
                            }
                        },
                        "patterns": [{"include": "source.js.jsx"}],
                    },
                    {"include": include},
                ],
            }
        )
    js_scopes = [
        "meta.embedded.block.javascript",
        "meta.embedded.block.javascriptreact",
        "meta.embedded.block.typescript",
    ]
    selector = ", ".join(
        f"L:{scope}{suffix} -string -comment"
        for scope in js_scopes
        for suffix in ("", ".fstring")
    )
    return {
        "$comment": "GENERATED by syntaxes/generate.py — do not edit by hand.",
        "scopeName": "reflex-jstemplate.injection",
        "injectionSelector": selector,
        "patterns": rules,
    }


def fstring_grammar() -> dict:
    """The second injection grammar: f-string placeholders in embedded regions.

    Returns:
        Grammar injected into every *.fstring embedded scope with left
        priority, so {placeholders} beat the embedded language's own rules at
        any nesting depth.
    """
    selector = ", ".join(f"L:{scope}.fstring" for scope in FSTRING_SCOPES)
    return {
        "$comment": "GENERATED by syntaxes/generate.py — do not edit by hand.",
        "scopeName": "reflex-fstring.injection",
        "injectionSelector": selector,
        "patterns": [
            {"match": "\\{\\{|\\}\\}", "name": "constant.character.escape.python"},
            {
                "begin": "\\{",
                "beginCaptures": {
                    "0": {
                        "name": "punctuation.definition.template-expression.begin.python"
                    }
                },
                "end": "\\}",
                "endCaptures": {
                    "0": {
                        "name": "punctuation.definition.template-expression.end.python"
                    }
                },
                "name": "meta.embedded.python",
                "contentName": "source.python",
                "patterns": [PY],
            },
        ],
    }


def main() -> None:
    """Generate both injection grammars from regions.json + css-properties.json."""
    with_method_body = "--no-method-body" not in sys.argv
    regions = json.loads((ROOT / "regions" / "regions.json").read_text())
    css_props = [
        p["snake"]
        for p in json.loads((ROOT / "regions" / "css-properties.json").read_text())
    ]
    lang_meta = {
        "javascript": ("meta.embedded.block.javascript", "source.js"),
        "javascriptreact": ("meta.embedded.block.javascriptreact", "source.js.jsx"),
        "typescript": ("meta.embedded.block.typescript", "source.ts"),
        "css": ("meta.embedded.block.css", "source.css"),
        "html": ("meta.embedded.block.html", "text.html.basic"),
    }

    repository: dict = {
        "string-escape": {
            "patterns": [
                {"match": "\\\\.", "name": "constant.character.escape.python"}
            ]
        },
        "style-dict-innards": style_dict_innards(),
    }

    top_level: list[dict] = []
    method_body_ctx: dict | None = None
    for ctx in regions["contexts"]:
        kind = ctx["kind"]
        if kind == "string-arg":
            rules = string_arg_rules(ctx)
        elif kind == "css-kwarg":
            blocked = set(regions["kwargBlocklist"])
            rules = css_kwarg_rules([p for p in css_props if p not in blocked])
        elif kind == "style-dict":
            rules = style_dict_rules(ctx, regions["pseudoProps"])
        elif kind == "class-string":
            rules = classname_rules(ctx)
        elif kind == "tag-inline":
            rules = tag_inline_rules(regions["tagLanguages"], lang_meta)
        elif kind == "tag-preceding":
            rules = tag_preceding_rules(ctx, regions["tagLanguages"], lang_meta)
        elif kind == "method-body":
            if not with_method_body:
                continue
            method_body_ctx = ctx
            rules = method_body_rules(ctx)
        else:
            raise ValueError(f"unknown context kind: {kind}")
        repository[ctx["id"]] = {"patterns": rules}
        top_level.append({"include": f"#{ctx['id']}"})

    grammar = {
        "$comment": "GENERATED by syntaxes/generate.py — do not edit by hand.",
        "scopeName": "reflex.injection",
        "injectionSelector": (
            "L:source.python -string -comment -meta.embedded"
            " -meta.function.reflex-custom-code.python"
        ),
        "fileTypes": ["py"],
        "patterns": top_level,
        "repository": repository,
    }
    out = ROOT / "syntaxes" / "reflex.injection.tmLanguage.json"
    out.write_text(json.dumps(grammar, indent=2) + "\n")
    print(f"wrote {out.relative_to(ROOT)} ({len(top_level)} contexts)")

    fs_out = ROOT / "syntaxes" / "reflex-fstring.injection.tmLanguage.json"
    fs_out.write_text(json.dumps(fstring_grammar(), indent=2) + "\n")
    print(f"wrote {fs_out.relative_to(ROOT)}")

    tpl_out = ROOT / "syntaxes" / "reflex-jstemplate.injection.tmLanguage.json"
    tpl_out.write_text(json.dumps(js_template_grammar(lang_meta), indent=2) + "\n")
    print(f"wrote {tpl_out.relative_to(ROOT)}")

    if method_body_ctx is not None:
        mb_out = ROOT / "syntaxes" / "reflex-methodbody.injection.tmLanguage.json"
        mb_out.write_text(
            json.dumps(method_body_strings_grammar(method_body_ctx), indent=2)
            + "\n"
        )
        print(f"wrote {mb_out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
