# Fathom for Raycast Changelog

## Fix full text search - {PR_MERGE_DATE}

### Changed

- Updated search implementation to include meeting summaries and transcripts in search index
- Added comprehensive logging for search performance monitoring

## Update to Fathom SDK 0.0.36 - 2025-11-09

### Changed

- Updated `fathom-typescript` dependency from 0.0.30 to 0.0.36
- Improved SDK integration with better error handling and validation
- Added fallback to HTTP requests when SDK validation fails

### Fixed

- Fixed TypeScript type safety issue with async iterator responses in `listMeetings`
- Enhanced error handling for edge cases in API responses

## [Initial Version] - 2025-10-19
