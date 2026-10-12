"""Verify distribution artifacts and catalogs without changing host settings."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import struct
import subprocess
import tempfile
import unittest
import zipfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pack", ROOT / "scripts/package-penecho-cloud.py")
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
VERSION = "1.1.4"
ENDPOINT = "https://penecho.ai/mcp"


class DistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archives = pack.build()

    def test_archive_members_are_complete_canonical_source(self):
        for path in self.archives:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                if path.name == "penecho-canvas.zip":
                    expected = {f"penecho-canvas/{name}" for name in pack.SKILL_FILES}
                    source_root = pack.SKILL
                    prefix = "penecho-canvas/"
                else:
                    hermes = path.name == "penecho-hermes-plugin.zip"
                    files = pack.HERMES_FILES if hermes else pack.PLUGIN_FILES
                    expected = {f"penecho-cloud/{name}" for name in files} | {f"penecho-cloud/skills/penecho-canvas/{name}" for name in pack.SKILL_FILES}
                    source_root = pack.HERMES if hermes else pack.PLUGIN
                    prefix = "penecho-cloud/"
                self.assertEqual(set(names), expected)
                self.assertEqual(len(names), len(expected))
                for name in names:
                    source = source_root / name.removeprefix(prefix)
                    self.assertFalse(source.is_symlink())
                    self.assertEqual(archive.read(name), source.read_bytes())
                    self.assertNotIn("uat", name)
                    self.assertFalse(name.endswith((".zip", ".pyc")))
                    self.assertNotIn("SUBMISSION.md", name)
                    self.assertNotIn("hermes/", name)

    def assert_native_transport(self, read):
        # Codex's portable root wins over the host-specific .mcp.json fallback.
        portable = json.loads(read("mcp.json"))
        self.assertEqual(portable["$schema"], "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json")
        self.assertEqual(set(portable["mcpServers"]), {"penecho-cloud"})
        connection = portable["mcpServers"]["penecho-cloud"]
        self.assertEqual(connection, {"type": "streamable-http", "url": ENDPOINT})
        # Codex 0.162.0-alpha.2 rejects server extensions and drops the MCP entry.
        self.assertNotIn("extensions", connection)
        fallback = json.loads(read(".mcp.json"))
        self.assertEqual(fallback, {"mcpServers": {"penecho-cloud": {"type": "http", "url": ENDPOINT}}})
        for data in (portable, fallback):
            for server in data["mcpServers"].values():
                self.assertNotIn("command", server)
                self.assertNotIn("args", server)

    def test_zip_and_github_directory_effective_transport_are_native(self):
        self.assert_native_transport(lambda name: (pack.PLUGIN / name).read_bytes())
        with zipfile.ZipFile(self.archives[1]) as archive:
            self.assert_native_transport(lambda name: archive.read(f"penecho-cloud/{name}"))
            versions = {json.loads(archive.read(f"penecho-cloud/{name}"))["version"] for name in ("plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", "server.json")}
            self.assertEqual(versions, {VERSION})
            manifest = json.loads(archive.read("penecho-cloud/.codex-plugin/plugin.json"))
            self.assertEqual(manifest["interface"]["supportURL"], "https://penecho.ai/contact.html")
            for name in archive.namelist():
                if name.endswith(".json") and "/skills/" not in name:
                    self.assertNotIn(b"mcp-remote", archive.read(name))

    def test_hermes_has_pinned_bridge_and_identical_canonical_skill(self):
        with zipfile.ZipFile(self.archives[2]) as archive:
            self.assertEqual(json.loads(archive.read("penecho-cloud/plugin.json"))["version"], VERSION)
            config = json.loads(archive.read("penecho-cloud/mcp.json"))
            self.assertEqual(config, pack.HERMES_MCP)
            server = config["mcpServers"]["penecho-cloud"]
            self.assertEqual(server["type"], "stdio")
            self.assertEqual(server["command"], "npx")
            self.assertEqual(server["args"], ["-y", "mcp-remote@0.1.38", ENDPOINT, "--transport", "http-only", "--resource", ENDPOINT])
            for name in pack.SKILL_FILES:
                canonical = (pack.SKILL / name).read_bytes()
                self.assertEqual((pack.HERMES / "skills/penecho-canvas" / name).read_bytes(), canonical)
                self.assertEqual(archive.read(f"penecho-cloud/skills/penecho-canvas/{name}"), canonical)

    def assert_codex_submission_metadata(self, read):
        # The official importer only falls back to this overlay when root com.openai is absent.
        portable = json.loads(read("plugin.json"))
        self.assertNotIn("com.openai", portable.get("extensions", {}))
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        listing = manifest["interface"]
        for field, limit in (("displayName", 30), ("shortDescription", 30), ("longDescription", 4000), ("developerName", 80)):
            value = listing[field]
            self.assertIsInstance(value, str)
            self.assertTrue(value.strip())
            self.assertLessEqual(len(value), limit, field)
            self.assertFalse(any(ord(char) < 32 for char in value), field)
        for field in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
            value = listing[field]
            url = urlsplit(value)
            self.assertEqual(url.scheme, "https")
            self.assertEqual(url.hostname, "penecho.ai")
            self.assertIsNone(url.username)
            self.assertIsNone(url.password)
            self.assertFalse(url.query)
            self.assertLessEqual(len(value), 1024)
        for field in ("logo", "composerIcon"):
            relative = listing[field]
            self.assertTrue(relative.startswith("./"))
            self.assertNotIn("..", Path(relative).parts)
            image = read(relative.removeprefix("./"))
            self.assertLessEqual(len(image), 5 * 1024 * 1024)
            self.assertEqual(image[:8], b"\x89PNG\r\n\x1a\n")
            width, height = struct.unpack(">II", image[16:24])
            self.assertEqual(width, height)
            self.assertGreaterEqual(width, 48)
            self.assertLessEqual(width, 4096)
        prompts = listing["defaultPrompt"]
        self.assertLessEqual(len(prompts), 3)
        self.assertEqual(len(set(prompts)), len(prompts))
        for prompt in prompts:
            self.assertTrue(prompt.strip())
            self.assertLessEqual(len(prompt), 128)
        extension = manifest["extensions"]["com.openai"]
        self.assertEqual(set(extension), {"review", "publication"})
        self.assertEqual(set(extension["review"]), {"test_cases"})
        self.assertEqual(set(extension["publication"]), {"release_notes"})
        self.assertTrue(extension["publication"]["release_notes"].strip())
        cases = extension["review"]["test_cases"]
        self.assertEqual(set(cases), {"positive", "negative"})
        self.assertEqual(len(cases["positive"]), 5)
        self.assertEqual(len(cases["negative"]), 3)
        # Canvas names come from its canonical schemas. Cloud adds these workspace tools.
        known_tools = set(re.findall(r'name:\s*[\'\"](penecho_[a-z_]+)', (ROOT / "src/server/mcp/schema.js").read_text()))
        known_tools.update({"penecho_open_workspace", "penecho_workspace_status"})
        for kind, group in cases.items():
            required = {"description", "prompt", "expected_behavior"}
            if kind == "positive":
                required.add("tools_triggered")
            for case in group:
                self.assertEqual(set(case), required)
                for field in required:
                    self.assertIsInstance(case[field], str)
                    self.assertTrue(case[field].strip())
                    self.assertLessEqual(len(case[field]), 4000)
                if kind == "positive":
                    tools = [name.strip() for name in case["tools_triggered"].split(",")]
                    self.assertEqual(len(set(tools)), len(tools))
                    self.assertTrue(set(tools) <= known_tools, tools)
        serialized = json.dumps(manifest).lower()
        for forbidden in ("test_credentials", "reviewer_instructions", "client_secret", "password", "bearer ", "example.com", "placeholder"):
            self.assertNotIn(forbidden, serialized)
        # A real recording and secure reviewer access remain portal inputs, never dummy data.
        self.assertNotIn("demo_recording_url", extension["review"])

    def test_current_codex_submission_metadata_in_source_and_delivered_zip(self):
        self.assert_codex_submission_metadata(lambda name: (pack.PLUGIN / name).read_bytes())
        with zipfile.ZipFile(self.archives[1]) as archive:
            self.assert_codex_submission_metadata(lambda name: archive.read(f"penecho-cloud/{name}"))

    def test_submission_checks_reject_invalid_listing_review_and_embedded_secrets(self):
        original = json.loads((pack.PLUGIN / ".codex-plugin/plugin.json").read_bytes())
        mutations = (
            lambda data: data["interface"].update(shortDescription="x" * 31),
            lambda data: data["interface"].update(supportURL="https://user:secret@penecho.ai/contact.html"),
            lambda data: data["extensions"]["com.openai"]["review"]["test_cases"]["positive"].pop(),
            lambda data: data["extensions"]["com.openai"]["review"]["test_cases"]["positive"][0].update(tools_triggered="penecho_transfer_money"),
            lambda data: data["extensions"]["com.openai"]["review"].update(test_credentials="secret"),
            lambda data: data["extensions"]["com.openai"]["review"].update(demo_recording_url="https://example.com/demo"),
        )
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                candidate = json.loads(json.dumps(original))
                mutate(candidate)
                def read(name):
                    return json.dumps(candidate).encode() if name == ".codex-plugin/plugin.json" else (pack.PLUGIN / name).read_bytes()
                with self.assertRaises(AssertionError):
                    self.assert_codex_submission_metadata(read)

    def test_marketplace_paths_and_versions_resolve_to_correct_variant(self):
        for catalog in (".claude-plugin/marketplace.json", ".cursor-plugin/marketplace.json"):
            marketplace = json.loads((ROOT / catalog).read_text())
            self.assertEqual(marketplace["name"], "penecho")
            self.assertEqual(len(marketplace["plugins"]), 1)
            entry = marketplace["plugins"][0]
            self.assertEqual(entry["name"], "penecho-cloud")
            self.assertEqual((ROOT / entry["source"]).resolve(), pack.PLUGIN)
            self.assertEqual(entry["version"], VERSION)
        marketplace = json.loads((ROOT / ".agents/plugins/marketplace.json").read_text())
        self.assertEqual(marketplace["name"], "penecho")
        self.assertEqual(marketplace["interface"]["displayName"], "PenEcho")
        self.assertEqual(len(marketplace["plugins"]), 1)
        entry = marketplace["plugins"][0]
        self.assertEqual(entry["name"], "penecho-cloud")
        self.assertEqual(entry["source"], {"source": "local", "path": "./integrations/penecho-cloud"})
        self.assertEqual((ROOT / entry["source"]["path"]).resolve(), pack.PLUGIN)
        self.assertEqual(entry["policy"], {"installation": "AVAILABLE", "authentication": "ON_INSTALL"})
        self.assertEqual(entry["category"], "Productivity")
        hermes = json.loads((pack.PLUGIN / "hermes/catalog-entry.json").read_text())
        self.assertEqual((ROOT / hermes["subdir"]).resolve(), pack.HERMES)
        self.assertEqual(hermes["version"], VERSION)
        self.assertEqual(hermes["version"], json.loads((pack.HERMES / "plugin.json").read_text())["version"])

    def test_rebuild_is_deterministic(self):
        before = [hashlib.sha256(path.read_bytes()).digest() for path in self.archives]
        after = [hashlib.sha256(path.read_bytes()).digest() for path in pack.build()]
        self.assertEqual(before, after)

    def test_native_plugin_upload_matches_zip_without_changing_build_return_contract(self):
        skill, plugin, hermes = pack.build()
        self.assertEqual((skill, plugin, hermes), self.archives)
        upload = pack.PLUGIN / "penecho-cloud.plugin"
        self.assertEqual(upload.read_bytes(), plugin.read_bytes())
        with zipfile.ZipFile(upload) as archive:
            self.assertIn("penecho-cloud/INSTALL.md", archive.namelist())
            self.assertIn("penecho-cloud/skills/penecho-canvas/scripts/install.mjs", archive.namelist())
            self.assertNotIn("penecho-cloud/penecho-cloud.plugin", archive.namelist())

    def test_prepare_marketplaces_derives_subdir_and_preserves_release_guards(self):
        # Use a real commit only inside a disposable unit fixture, never pin the actual release.
        with tempfile.TemporaryDirectory(prefix="penecho-marketplace-unit-") as temporary:
            fixture = Path(temporary)
            script = fixture / "scripts/prepare-penecho-marketplaces.cjs"
            script.parent.mkdir()
            script.write_bytes((ROOT / "scripts/prepare-penecho-marketplaces.cjs").read_bytes())
            for name in ("plugin.json", "hermes/catalog-entry.json", "hermes/optional-mcps/penecho/manifest.yaml"):
                destination = fixture / "integrations/penecho-cloud" / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((pack.PLUGIN / name).read_bytes())
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=fixture, text=True).strip()
            git("init", "-q")
            git("add", ".")
            git("-c", "user.name=Distribution Unit Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture for release guard unit test")
            sha = git("rev-parse", "HEAD")
            def prepare(value):
                return subprocess.run(["node", str(script), f"--sha={value}"], cwd=fixture, capture_output=True, text=True)
            result = prepare(sha)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = fixture / f"dist/penecho-marketplaces/{VERSION}"
            entry = json.loads((output / "penecho.yaml").read_text())
            hermes_pack = json.loads((output / "hermes-pack.yaml").read_text())
            self.assertEqual(entry["sha"], sha)
            self.assertEqual(hermes_pack["plugins"][0]["subdir"], "integrations/penecho-cloud/hermes/portable")
            self.assertEqual(hermes_pack["plugins"][0]["ref"], sha)
            self.assertNotEqual(prepare("main").returncode, 0)
            tracked = fixture / "integrations/penecho-cloud/plugin.json"
            original = tracked.read_text()
            tracked.write_text(original + "\n")
            self.assertIn("Commit the complete plugin package", prepare(sha).stderr)
            tracked.write_text(original)
            (tracked.parent / "untracked.txt").write_text("fixture")
            self.assertIn("Commit the complete plugin package", prepare(sha).stderr)
            (tracked.parent / "untracked.txt").unlink()
            earlier = original.replace(VERSION, "0.0.1")
            tracked.write_text(earlier)
            self.assertIn("release commit does not contain this plugin version", prepare(sha).stderr)


if __name__ == "__main__":
    unittest.main()
