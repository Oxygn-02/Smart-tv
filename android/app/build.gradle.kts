plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.oxygn02.smarttv"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.oxygn02.smarttv"
        // Android TV 8.0+. Google TV sets are Android 10 or later.
        minSdk = 26
        targetSdk = 34
        versionCode = 17
        versionName = "0.10"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.palette:palette-ktx:1.0.0")
    // Tiny web server for "Set up from your phone" (Govee key, wallpapers).
    implementation("org.nanohttpd:nanohttpd:2.3.1")
}
