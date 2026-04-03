from pathlib import Path
import sys
import unittest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.build_connect_artists_site import build_entry_html


class BuildConnectArtistsSiteTests(unittest.TestCase):
    def test_build_entry_html_updates_public_branding(self) -> None:
        source_html = """
<title>Spotify Universe | 3D Artist Explorer</title>
<meta name=\"description\" content=\"Explore 900,000+ artists in an interactive 3D galaxy powered by AI embeddings.\">
<script src=\"./app.js\"></script>
"""

        output_html = build_entry_html(source_html)

        self.assertIn("<title>Spotify Universe | Connect Artists</title>", output_html)
        self.assertIn(
            'content="Trace artist collaboration routes and blend artist DNA in a free browser-native public edition."',
            output_html,
        )
        self.assertIn("window.__SPOTIFY_FORCE_CONNECT_ONLY__ = true;", output_html)
        self.assertIn('<script src="./app.js"></script>', output_html)

    def test_build_entry_html_injects_force_flag_once(self) -> None:
        source_html = '<script src="./app.js"></script>'

        output_html = build_entry_html(source_html)

        self.assertEqual(output_html.count("window.__SPOTIFY_FORCE_CONNECT_ONLY__ = true;"), 1)

    def test_public_shell_files_do_not_contain_mojibake(self) -> None:
        public_shell_files = [
            "web/index.html",
            "web/connect-artists.html",
            "web/app.js",
            "docs/index.html",
            "docs/404.html",
            "docs/app.js",
        ]

        for relative_path in public_shell_files:
            with self.subTest(relative_path=relative_path):
                content = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertNotRegex(content, r"â|Ã")


if __name__ == "__main__":
    unittest.main()
