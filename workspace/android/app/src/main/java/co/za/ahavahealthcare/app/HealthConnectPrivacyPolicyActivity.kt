package co.za.ahavahealthcare.app

import android.app.Activity
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Required by Google Play Health Connect policy.
 * Shown when the user taps "See privacy policy" from the Health Connect
 * permissions dialog. Must be registered in AndroidManifest.xml with
 * action: androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE
 */
class HealthConnectPrivacyPolicyActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val webView = WebView(this).apply {
            settings.javaScriptEnabled = false
            settings.domStorageEnabled = false
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean = false
            }
            val privacyUrl = "https://app.ahavaon88.co.za/legal/privacy-policy"
            loadUrl(privacyUrl)
        }

        setContentView(webView)
    }
}
