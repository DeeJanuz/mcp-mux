#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserPlatform {
    Linux,
    MacOs,
    Windows,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BrowserCommand {
    pub program: &'static str,
    pub args: Vec<String>,
}

pub(crate) fn current_platform() -> BrowserPlatform {
    #[cfg(target_os = "linux")]
    {
        return BrowserPlatform::Linux;
    }

    #[cfg(target_os = "macos")]
    {
        return BrowserPlatform::MacOs;
    }

    #[cfg(target_os = "windows")]
    {
        return BrowserPlatform::Windows;
    }

    #[allow(unreachable_code)]
    BrowserPlatform::Unsupported
}

pub(crate) fn browser_command_for_platform(
    url: &str,
    platform: BrowserPlatform,
) -> Result<BrowserCommand, String> {
    match platform {
        BrowserPlatform::Linux => Ok(BrowserCommand {
            program: "xdg-open",
            args: vec![url.to_string()],
        }),
        BrowserPlatform::MacOs => Ok(BrowserCommand {
            program: "open",
            args: vec![url.to_string()],
        }),
        // rundll32 receives the URL as one process argument. That avoids cmd.exe
        // parsing failures for OAuth/update URLs containing &, %, quotes, or spaces.
        BrowserPlatform::Windows => Ok(BrowserCommand {
            program: "rundll32",
            args: vec!["url.dll,FileProtocolHandler".to_string(), url.to_string()],
        }),
        BrowserPlatform::Unsupported => Err("Unsupported platform".to_string()),
    }
}

pub(crate) fn open_system_browser(url: &str) -> Result<(), String> {
    let command = browser_command_for_platform(url, current_platform())?;
    std::process::Command::new(command.program)
        .args(command.args)
        .spawn()
        .map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(())
}

pub(crate) fn open_http_url(raw_url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(raw_url).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => open_system_browser(parsed.as_str()),
        scheme => Err(format!("Unsupported URL protocol: {}", scheme)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_browser_command_preserves_url_as_single_argument() {
        let url = "https://example.com/oauth?state=a%20b&redirect_uri=https%3A%2F%2Fapp.test%2Fcb";
        let command = browser_command_for_platform(url, BrowserPlatform::Windows).unwrap();

        assert_eq!(command.program, "rundll32");
        assert_eq!(
            command.args,
            vec!["url.dll,FileProtocolHandler".to_string(), url.to_string()]
        );
    }

    #[test]
    fn unsupported_browser_platform_returns_error() {
        let error =
            browser_command_for_platform("https://example.com", BrowserPlatform::Unsupported)
                .expect_err("unexpectedly built a command for unsupported platform");

        assert!(error.contains("Unsupported platform"));
    }
}
