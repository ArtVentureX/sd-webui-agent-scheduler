(function agent_scheduler_init() {
  const head = document.head || document.querySelector('head');

  window.__loaded_scripts = [];

  const insertStyleTag = (href) => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = href;
    head.appendChild(style);
  };

  const insertScriptTag = (src, onload) => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    head.appendChild(script);
    script.onload = onload;
    script.src = src;
  };

  // load ag-grid
  insertStyleTag('https://cdn.jsdelivr.net/npm/ag-grid-community@29.3.3/styles/ag-grid.css');
  insertStyleTag(
    'https://cdn.jsdelivr.net/npm/ag-grid-community@29.3.3/styles/ag-theme-alpine.css',
  );
  insertScriptTag(
    'https://cdn.jsdelivr.net/npm/ag-grid-community@29.3.3/dist/ag-grid-community.min.noStyle.js',
    () => {
      window.__loaded_scripts.push('agGrid');
    },
  );

  // load rxjs
  insertScriptTag('https://cdnjs.cloudflare.com/ajax/libs/rxjs/7.8.1/rxjs.umd.min.js', () => {
    window.__loaded_scripts.push('rxjs');

    const observable = new rxjs.Observable((observer) => {
      function submit_enqueue() {
        var id = randomId();
        var res = create_submit_args(arguments);
        res[0] = id;

        document.querySelector('#txt2img_enqueue').innerHTML = 'Queued';
        setTimeout(() => {
          document.querySelector('#txt2img_enqueue').innerHTML = 'Enqueue';
          observer.next({ type: 'txt2img', id });
        }, 1000);

        return res;
      }

      function submit_enqueue_img2img() {
        var id = randomId();
        var res = create_submit_args(arguments);
        res[0] = id;
        res[1] = get_tab_index('mode_img2img');

        document.querySelector('#img2img_enqueue').innerHTML = 'Queued';
        setTimeout(() => {
          document.querySelector('#img2img_enqueue').innerHTML = 'Enqueue';
          observer.next({ type: 'txt2img', id });
        }, 1000);

        return res;
      }

      submit_enqueue.subscribe = observable.subscribe.bind(observable);
      submit_enqueue_img2img.subscribe = observable.subscribe.bind(observable);

      window.submit_enqueue = submit_enqueue;
      window.submit_enqueue_img2img = submit_enqueue_img2img;
    });

    // register a dummy subscriber
    observable.subscribe({
      next: console.log,
      error: console.error,
      complete: console.log,
    });
  });

  // notyf
  insertStyleTag('https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.css');
  insertScriptTag('https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.js', () => {
    window.__loaded_scripts.push('notyf');
  });
})();

onUiLoaded(function initTaskScheduler() {
  if (window.__loaded_scripts.length < 3) {
    return setTimeout(() => {
      initTaskScheduler()
    }, 200);
  }

  // detect black-orange theme
  if (document.querySelector('link[href*="black-orange.css"]')) {
    document.body.classList.add('black-orange');
  }

  // init notyf
  const notyf = new Notyf();

  // init state
  const subject = new rxjs.Subject();

  const store = {
    subject,
    init: (initialState) => {
      return (store.subject = subject.pipe(rxjs.startWith(initialState)));
    },
    subscribe: (callback) => {
      return store.subject.pipe(rxjs.pairwise()).subscribe(callback);
    },
    refresh: async () => {
      return fetch('/agent-scheduler/v1/queue?limit=1000')
        .then((response) => response.json())
        .then((data) => {
          const pending_tasks = data.pending_tasks.map((item) => ({
            ...item,
            params: JSON.parse(item.params),
            status: item.id === data.current_task_id ? 'running' : 'pending',
          }));
          store.subject.next({
            ...data,
            pending_tasks,
          });
        });
    },
    pauseQueue: async () => {
      return fetch('/agent-scheduler/v1/pause', { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        })
    },
    resumeQueue: async () => {
      return fetch('/agent-scheduler/v1/resume', { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        })
    },
    runTask: async (id) => {
      return fetch(`/agent-scheduler/v1/run/${id}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
    deleteTask: async (id) => {
      return fetch(`/agent-scheduler/v1/delete/${id}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
    moveTask: async (id, overId) => {
      return fetch(`/agent-scheduler/v1/move/${id}/${overId}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
  };

  store.init({
    current_task_id: null,
    total_pending_tasks: 0,
    pending_tasks: [],
    paused: false
  });

  // init actions
  const refreshButton = gradioApp().querySelector('#agent_scheduler_action_refresh');
  refreshButton.addEventListener('click', () => {
    store.refresh();
  });
  const pauseButton = gradioApp().querySelector('#agent_scheduler_action_pause');
  pauseButton.addEventListener('click', () => {
    store.pauseQueue();
  });
  const resumeButton = gradioApp().querySelector('#agent_scheduler_action_resume');
  resumeButton.addEventListener('click', () => {
    store.resumeQueue();
  });
  const searchContainer = gradioApp().querySelector('#agent_scheduler_action_search');
  searchContainer.className = "ts-search";
  searchContainer.innerHTML = `
    <div class="ts-search-icon">
    <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/>
      <path d="M21 21l-6 -6"/>
    </svg>
    </div>
    <input type="text" id="agent_scheduler_search_input" class="ts-search-input" placeholder="Search" required>
  `;


  // init grid

  const eGridDiv = gradioApp().querySelector('#agent_scheduler_pending_tasks_grid');
  if (document.querySelector('.dark')) {
    eGridDiv.className = 'ag-theme-alpine-dark';
  }

  const deleteIcon = `
    <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M4 7l16 0"/>
      <path d="M10 11l0 6"/>
      <path d="M14 11l0 6"/>
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/>
      <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>
    </svg>`;
  const cancelIcon = `
    <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M18 6l-12 12"/>
      <path d="M6 6l12 12"/>
    </svg>
  `;
  const pendingTasksGridOptions = {
    domLayout: 'autoHeight',
    // each entry here represents one column
    columnDefs: [
      {
        field: 'id',
        headerName: 'Task Id',
        minWidth: 240,
        maxWidth: 240,
        pinned: 'left',
        rowDrag: true,
        cellClass: ({ data }) => (data.status === 'running' ? 'task-running' : ''),
      },
      { field: 'type', headerName: 'Type', minWidth: 80, maxWidth: 80 },
      {
        field: 'priority',
        headerName: 'Priority',
        minWidth: 120,
        maxWidth: 120,
        filter: 'agNumberColumnFilter',
        valueGetter: ({ data }) => data.priority - 1_681_000_000_000,
        hide: true,
      },
      {
        headerName: 'Params',
        children: [
          {
            field: 'params.checkpoint',
            headerName: 'Checkpoint', minWidth: 150, maxWidth: 300,
            valueFormatter: ({ value }) => value || 'System'
          },
          {
            field: 'params.prompt',
            headerName: 'Prompt',
            width: 400,
            minWidth: 200,
            wrapText: true,
            autoHeight: true,
            cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
          },
          {
            field: 'params.negative_prompt',
            headerName: 'Negative Prompt',
            width: 400,
            minWidth: 200,
            wrapText: true,
            autoHeight: true,
            cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
          },
          {
            field: 'params.sampler_name',
            headerName: 'Sampler',
            width: 150,
            minWidth: 150,
          },
          {
            field: 'params.steps',
            headerName: 'Steps',
            minWidth: 80,
            maxWidth: 80,
            filter: 'agNumberColumnFilter',
          },
          {
            field: 'params.cfg_scale',
            headerName: 'CFG Scale',
            width: 100,
            minWidth: 100,
            filter: 'agNumberColumnFilter',
          },
          {
            field: 'params.size',
            headerName: 'Size',
            minWidth: 110,
            maxWidth: 110,
            valueGetter: ({ data }) => `${data.params.width}x${data.params.height}`,
          },
          {
            field: 'params.batch',
            headerName: 'Batching',
            minWidth: 100,
            maxWidth: 100,
            valueGetter: ({ data }) => `${data.params.n_iter}x${data.params.batch_size}`,
          },
        ],
      },
      { field: 'created_at', headerName: 'Date', minWidth: 200 },
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        valueGetter: ({ data }) => data.id,
        cellRenderer: ({ api, value, data }) => {
          const html = `
            <div class="inline-flex rounded-md shadow-sm mt-1.5" role="group">
              <button type="button" ${data.status === 'running' ? 'disabled' : ''} class="ts-btn-action ts-btn-run">
                <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                  <path d="M7 4v16l13 -8z"/>
                </svg>
              </button>
              <button type="button" class="ts-btn-action ts-btn-delete">
                ${data.status === 'pending' ? deleteIcon : cancelIcon}
              </button>
            </div>
            `;

          const placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          const node = placeholder.firstElementChild;

          const btnRun = node.querySelector('button.ts-btn-run');
          btnRun.addEventListener('click', () => {
            console.log('run', value);
            api.showLoadingOverlay();
            store.runTask(value).then(() => api.hideOverlay());
          });

          const btnDelete = node.querySelector('button.ts-btn-delete');
          btnDelete.addEventListener('click', () => {
            console.log('delete', value);
            api.showLoadingOverlay();
            store.deleteTask(value).then(() => api.hideOverlay());
          });

          return node;
        },
      },
    ],
    getRowId: ({ data }) => data.id,

    // default col def properties get applied to all columns
    defaultColDef: { sortable: false, filter: true, resizable: true, suppressMenu: true },

    rowSelection: 'single', // allow rows to be selected
    animateRows: true, // have rows animate to new positions when sorted
    pagination: true,
    paginationPageSize: 10,
    getContextMenuItems: () => [],
    suppressCopyRowsToClipboard: true,
    sideBar: {
      toolPanels: [
        {
          id: 'columns',
          labelDefault: 'Columns',
          labelKey: 'columns',
          iconKey: 'columns',
          toolPanel: 'agColumnsToolPanel',
          toolPanelParams: {
            suppressRowGroups: true,
            suppressValues: true,
            suppressPivots: true,
            suppressPivotMode: true,
          },
        },
        {
          id: 'filters',
          labelDefault: 'Filters',
          labelKey: 'filters',
          iconKey: 'filter',
          toolPanel: 'agFiltersToolPanel',
        },
      ],
      position: 'right',
    },

    onGridReady: ({ api, columnApi }) => {
      // init quick search input
      const searchInput = searchContainer.querySelector('input#agent_scheduler_search_input');
      rxjs
        .fromEvent(searchInput, 'input')
        .pipe(rxjs.debounce(() => rxjs.interval(200)))
        .subscribe((e) => {
          api.setQuickFilter(e.target.value);
        });

      store.subscribe({
        next: ([_, newState]) => {
          api.setRowData(newState.pending_tasks);
          if (newState.current_task_id) {
            const node = api.getRowNode(newState.current_task_id);
            if (node) {
              api.refreshCells({ rowNodes: [node], force: true });
            }
          }

          columnApi.autoSizeColumns();
        },
      });
    },
    onRowDragEnd: ({ api, node, overNode }) => {
      const id = node.data.id;
      const overId = overNode.data.id;

      api.showLoadingOverlay();
      store.moveTask(id, overId).then(() => api.hideOverlay());
    },
  };
  new agGrid.Grid(eGridDiv, pendingTasksGridOptions);

  // watch for current task id change
  const onTaskIdChange = (id) => {
    if (id) {
      requestProgress(
        id,
        gradioApp().getElementById('agent_scheduler_current_task_progress'),
        gradioApp().getElementById('agent_scheduler_current_task_images'),
        () => {
          setTimeout(() => {
            store.refresh();
          }, 1000);
        },
      );
    }
  };
  store.subscribe({
    next: ([prev, curr]) => {
      if (prev.current_task_id !== curr.current_task_id) {
        onTaskIdChange(curr.current_task_id);
      }
      if (curr.paused) {
        pauseButton.classList.add('hide');
        resumeButton.classList.remove('hide');
      } else {
        pauseButton.classList.remove('hide');
        resumeButton.classList.add('hide');
      }
    },
  });

  // watch for task submission
  window.submit_enqueue.subscribe({
    next: () => store.refresh(),
  });

  // refresh the state
  store.refresh();
});
