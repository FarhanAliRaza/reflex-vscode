# language=js
ON_LOAD = """
window.addEventListener("load", () => {
    console.log("loaded");
});
"""

# js
SNIPPET = "document.querySelector('#app')"

# language=css
THEME_CSS = """
:root {
    --accent: #756aee;
}
.button:hover { background: var(--accent); }
"""

INLINE_TAGGED = """#js
const answer = 42;
console.log(answer);
"""

STYLES = '''#css
.badge { border-radius: 2px; }
'''

# language=html
TEMPLATE = """
<section>
    <h1>Title</h1>
</section>
"""

# this ordinary comment must not tag anything
NOT_TAGGED = """
plain python string
"""
