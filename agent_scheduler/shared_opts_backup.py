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
        Sets a shared option and backs it up.

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
        self.shared_opts: dict[str, any] = shared_opts
        self.backup: dict[str, any] = {}

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
            setattr(self.backup, key, self.shared_opts.get(key))
        setattr(self.shared_opts, key, value)

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
        return self.backup.get(key) if self.is_backup_exists(key) else self.shared_opts.get(key)

    def restore_shared_opts(self):
        """
        Restores the shared options from the backup.
        """
        for attr, value in self.backup.items():
            setattr(self.shared_opts, attr, value)
