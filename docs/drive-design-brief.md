# Kimono Drive design brief

Kimono Drive is a simple, self-hosted place to keep files, organize them into
folders, and share them. It should feel like part of Kimono and make it easy to
upload a file and copy a direct link that embeds in Discord where the media
format supports it.

## Spaces and folders

People can create spaces, each containing files and folders. A space is the
unit of shared access: its owner can invite other people and manage their
access. Ordinary folders organize content within a space and inherit its
access.

An existing folder can be converted into a new space, carrying its contents
with it. This is a way to give that collection its own membership, rather than
requiring people to share every file individually. The effect on existing
access should be understandable before the conversion happens.

## Sharing files

Individual files can have public, direct links suitable for sharing outside
Kimono, including in Discord. Creating a public link is distinct from granting
someone access to a space. People should understand what they are exposing and
be able to revoke a link.

Private content remains accessible only to people with the relevant access.
Renaming or reorganizing content should preserve links where practical.

## Product direction

Keep the first version focused on uploading, browsing, organizing, creating
spaces, inviting people, converting folders into spaces, and sharing files.
Use Kimono's existing design language and identity conventions. The specific
screens, navigation, interactions, and presentation are for the implementer
to decide.

## Decisions left open

Choose the architecture, database, storage backend, and delivery approach to
suit a small self-hosted deployment. Local filesystem storage, B2, or another
object store are options; none is prescribed here. Account for persistence,
backup and recovery, and serving larger media without loading entire files
into memory.

The implementer should also settle membership roles, space nesting, ownership
on conversion, handling of existing public links during access changes, and
upload limits. Favor simple rules that people can predict. This brief defines
the intended capabilities without committing to a schema, API, service layout,
or UI design.
