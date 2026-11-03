import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The key every launcher update must be signed with. It is NOT in the repo:
// android/keystore.properties (git-ignored) says where it is, e.g.
//   storeFile=/path/to/smart-tv-signing.keystore
//   storePassword=...
//   keyAlias=...
//   keyPassword=...
// Losing this key means updates can no longer install over the app on the TV.
val signing = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.oxygn02.smarttv"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.oxygn02.smarttv"
        // Android TV 8.0+. Google TV sets are Android 10 or later.
        minSdk = 26
        targetSdk = 34
        versionCode = 29
        versionName = "0.19"
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("tv") {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Not debuggable: no WebView remote debugging, no run-as into the app's files.
            signingConfig = signingConfigs.findByName("tv")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // The web UI in ../launcher (and photos in ../wallpapers) ship inside the
    // app as assets; see copyWebUi below.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webui"))
}

// Copy the launcher UI into the app on every build, so launcher/ stays the
// single source of the design.
val copyWebUi by tasks.registering(Sync::class) {
    from(rootProject.file("../launcher")) {
        include("index.html", "styles.css", "*.js", "fonts/*")
        exclude("demo-bridge.js") // the browser preview's pretend TV, never in the app
        into("web")
    }
    from(rootProject.file("../wallpapers")) {
        exclude(".gitkeep")
        into("wallpapers")
    }
    into(layout.buildDirectory.dir("generated/webui"))
}
tasks.named("preBuild") { dependsOn(copyWebUi) }

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20231013") // real org.json for BackupSchema tests
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.palette:palette-ktx:1.0.0")
    // Tiny web server for "Set up from your phone" (Govee key, wallpapers).
    implementation("org.nanohttpd:nanohttpd:2.3.1")
}
