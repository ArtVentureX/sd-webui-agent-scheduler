from pathlib import Path, PurePath

class SharedOptsBackup:
    """
    A class used to backup and restore shared options.

    Attributes
    ----------
    shared_opts : dict
        The shared options to be backed up and restored.
    backup : dict
        A dictionary to store the backup of shared options.

    Methods
    -------
    set_shared_opts_core(key: str, value)
        Sets a shared option and backs it up only if it is not already backed up.

    set_shared_opts(**kwargs)
        Sets multiple shared options and backs them up.

    restore_shared_opts()
        Restores the shared options from the backup.
    """

    def __init__(self, shared_opts):
        """
        Constructs all the necessary attributes for the SharedOptsBackup object.

        Parameters
        ----------
        shared_opts : dict
            The shared options to be backed up and restored.
        """
        self.shared_opts = shared_opts
        self.backup = {}

    def set_shared_opts_core(self, key: str, value):
        """
        Sets a shared option and backs it up only if it is not already backed up.

        Parameters
        ----------
        key : str
            The key of the shared option to be set.
        value : any
            The value to be set for the shared option.
        """
        if not self.is_backup_exists(key):
            old = getattr(self.shared_opts, key, None)
            self.backup[key] = old
            print(f"[AgentScheduler] {key} is backup: {old}")

        if isinstance(value, (Path, PurePath)):
            value = str(value)

        self.shared_opts.set(key, value)
        print(f"[AgentScheduler] {key} is changed: {value}")

    def set_shared_opts(self, **kwargs):
        """
        Sets multiple shared options and backs them up.

        Parameters
        ----------
        kwargs : dict
            The key-value pairs of shared options to be set.
        """
        for attr, value in kwargs.items():
            self.set_shared_opts_core(attr, value)

    def is_backup_exists(self, key: str):
        return key in self.backup

    def get_backup_value(self, key: str):
        return self.backup.get(key) if self.is_backup_exists(key) else getattr(self.shared_opts, key, None)

    def restore_shared_opts(self):
        """
        Restores the shared options from the backup.
        """
        for attr, value in self.backup.items():
            self.shared_opts.set(attr, value)
            print(f"[AgentScheduler] {attr} is restore: {value}")
