package io.github.oxygn02.smarttv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupSchemaTest {
    @Test
    fun keepsKnownSettings() {
        val out = BackupSchema.clean(JSONObject("""{"edge":"media","edgeInt":80,"clock24":true,"town":"Leeds","games":{"hdmiPort":2,"autoSwitch":true,"countdownSec":5}}"""))
        assertEquals("media", out.getString("edge"))
        assertEquals(80.0, out.getDouble("edgeInt"), 0.0)
        assertTrue(out.getBoolean("clock24"))
        assertEquals(2, out.getJSONObject("games").getInt("hdmiPort"))
    }

    @Test
    fun dropsUnknownAndDangerousKeys() {
        val out = BackupSchema.clean(JSONObject("""{"updateUrl":"https://evil.example/x.apk","chosenApps":["com.android.settings"],"safety":false,"updateChannel":"beta","edge":"<script>","edgeInt":9999}"""))
        assertEquals(0, out.length())
    }

    @Test
    fun cleansScenes() {
        val scenes = JSONArray().put(JSONObject("""{"id":"s1","name":"Film night","backlight":"ocean","lights":{"AA":true,"bad id!":true,"BB":"yes"}}"""))
            .put(JSONObject("""{"id":"<img>","name":"x"}"""))
            .put(JSONObject("""{"id":"s3","name":""}"""))
        val out = BackupSchema.clean(JSONObject().put("myScenes", scenes)).getJSONArray("myScenes")
        assertEquals(1, out.length())
        val l = out.getJSONObject(0).getJSONObject("lights")
        assertTrue(l.getBoolean("AA"))
        assertFalse(l.has("bad id!"))
        assertFalse(l.has("BB"))
    }

    @Test
    fun scenesWithoutLightsStillHaveTheField() {
        val out = BackupSchema.clean(JSONObject().put("myScenes", JSONArray().put(JSONObject("""{"id":"s1","name":"A"}"""))))
        assertTrue(out.getJSONArray("myScenes").getJSONObject(0).has("lights"))
    }
}
