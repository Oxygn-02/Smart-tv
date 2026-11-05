package io.github.oxygn02.smarttv

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Every Android function the launcher page calls (nativeCall, nativeJson,
 * nativeFetch in launcher/app.js and bridge.js) must exist on the Android side
 * as a @JavascriptInterface method. A missing one fails silently on the TV
 * (the page just gets nothing back), so it fails here instead.
 */
class BridgeContractTest {
    private fun find(rel: String): File =
        listOf(File(rel), File("../$rel"), File("../../$rel")).firstOrNull { it.exists() } ?: error("Can't find $rel")

    @Test
    fun everyCallFromThePageExistsOnAndroid() {
        val js = listOf("launcher/app.js", "launcher/bridge.js").joinToString("\n") { find(it).readText() }
        val called = Regex("""native(?:Call|Json|Fetch)\('([A-Za-z]+)'""").findAll(js).map { it.groupValues[1] }.toSortedSet()

        val kt = find("android/app/src/main/java/io/github/oxygn02/smarttv").listFiles { f -> f.extension == "kt" }!!.joinToString("\n") { it.readText() }
        val exposed = Regex("""@JavascriptInterface\s+(?:@\w+\s+)*fun\s+([A-Za-z]+)""").findAll(kt).map { it.groupValues[1] }.toSet()

        val missing = called - exposed
        assertTrue("The page calls these, but Android doesn't have them: $missing", missing.isEmpty())
        assertTrue("Found too few calls (${called.size}); is the pattern still right?", called.size > 40)
    }
}
