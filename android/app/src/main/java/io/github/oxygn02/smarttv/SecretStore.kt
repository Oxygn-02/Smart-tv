package io.github.oxygn02.smarttv

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * API keys and the guest Wi-Fi password, encrypted with AES-GCM under a key
 * that lives in the TV's Android Keystore (it never leaves the hardware-backed
 * store and is not in any backup). Values saved in plain text by older versions
 * are moved in here the first time they are read.
 */
object SecretStore {
    private const val ALIAS = "smart-tv-secrets"
    private const val PREFS = "secrets"
    private val cache = HashMap<String, String>()

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    @Synchronized
    fun put(context: Context, name: String, value: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        cache[name] = value
        if (value.isEmpty()) {
            prefs.edit().remove(name).apply()
            return
        }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = c.iv + c.doFinal(value.toByteArray())
        prefs.edit().putString(name, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    @Synchronized
    fun get(context: Context, name: String): String {
        cache[name]?.let { return it }
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(name, null) ?: return ""
        return try {
            val bytes = Base64.decode(raw, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
            String(c.doFinal(bytes, 12, bytes.size - 12)).also { cache[name] = it }
        } catch (_: Exception) {
            ""
        }
    }

    /** Reads a secret, first moving a plain-text value left by an older version (then deleting it). */
    fun migrate(context: Context, name: String, oldPrefs: String, oldKey: String): String {
        val old = context.getSharedPreferences(oldPrefs, Context.MODE_PRIVATE)
        old.getString(oldKey, null)?.let { plain ->
            if (plain.isNotEmpty()) put(context, name, plain)
            old.edit().remove(oldKey).commit()
        }
        return get(context, name)
    }
}
